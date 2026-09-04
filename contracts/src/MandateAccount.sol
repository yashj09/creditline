// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMandateFactory} from "./interfaces/IMandateFactory.sol";

/// @title MandateAccount
/// @notice A user-owned smart account that lets an AI agent act within a bounded mandate.
///
/// Roles
///  - owner:    the human who owns the funds; sets the mandate, the policy, the agent and the guardian.
///  - agent:    the AI agent's wallet. May call `execute` for steps that stay inside the mandate.
///  - guardian: a hardware wallet (Ledger). Co-signs steps that exceed the mandate or are flagged
///              `requiresGuardian` (irreversible actions such as bridging or paying a third party).
///
/// Enforcement
///  - Every call's (target, selector) must be allow-listed by the owner. Wildcard target = address(0).
///  - Spend caps are enforced on the *measured* USDC outflow of the whole step (ERC-20 balance delta, plus
///    native balance delta on chains where USDC is the gas token), not on a number the agent declares.
///  - Guardian approvals are EIP-191 personal-sign messages in a fixed human-readable format so a Ledger
///    can clear-sign them without blind signing. The contract rebuilds the exact text and recovers the signer.
contract MandateAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @dev Caps are in USDC base units (6 decimals). expiry == 0 means no active mandate.
    struct Mandate {
        uint128 perTxCap;
        uint128 dailyCap;
        uint64 expiry;
    }

    struct Policy {
        bool allowed;
        bool requiresGuardian;
    }

    struct PolicyInput {
        address target;
        bytes4 selector;
        bool allowed;
        bool requiresGuardian;
    }

    struct Repayment {
        uint64 dueAt;
        uint128 amount; // USDC 6-dec
        address venue; // lending market to repay into (informational; execution is a normal step)
        bool done;
    }

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    address public owner;
    address public guardian;
    address public agent;

    /// @notice ERC-20 USDC on this chain (on Arc this is the ERC-20 view of the native gas token).
    address public immutable USDC;
    /// @notice True on chains where the native gas token is USDC (Arc). Native deltas then count as USDC.
    bool public immutable NATIVE_IS_USDC;

    Mandate public mandate;
    mapping(address target => mapping(bytes4 selector => Policy)) public policies;

    uint64 public windowStart;
    uint128 public dailySpent;
    uint256 public guardianNonce;

    Repayment[] public repayments;

    // ---------------------------------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------------------------------

    event StepExecuted(bytes32 indexed planId, uint8 indexed step, uint256 usdcOut, bytes32 callsHash, bool guarded);
    event GuardianApproved(bytes32 indexed planId, uint8 indexed step, address guardian, uint256 nonce);
    event MandateUpdated(uint128 perTxCap, uint128 dailyCap, uint64 expiry);
    event PolicyUpdated(address indexed target, bytes4 indexed selector, bool allowed, bool requiresGuardian);
    event AgentUpdated(address agent);
    event GuardianUpdated(address guardian);
    event OwnerUpdated(address owner);
    event RepaymentScheduled(uint256 indexed id, uint64 dueAt, uint128 amount, address venue);
    event RepaymentDone(uint256 indexed id);

    error NotOwner();
    error NotAgent();
    error NotOwnerOrAgent();
    error MandateInactive();
    error MandateExpired();
    error CallNotAllowed(address target, bytes4 selector);
    error GuardianRequired(address target, bytes4 selector);
    error PerTxCapExceeded(uint256 spent, uint256 cap);
    error DailyCapExceeded(uint256 spent, uint256 cap);
    error MaxOutExceeded(uint256 spent, uint256 maxOut);
    error ApprovalExpired();
    error BadGuardianSignature();
    error CallFailed(uint256 index, bytes returndata);
    error ZeroAddress();
    error NoGuardian();
    error InvalidRepayment();

    // ---------------------------------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------------------------------

    /// @dev Deployed by MandateFactory via CREATE2. Chain-specific USDC config is read from the factory so
    ///      the init code (and therefore the account address) is identical on every chain.
    constructor(address owner_, address guardian_, address agent_) {
        if (owner_ == address(0) || agent_ == address(0)) revert ZeroAddress();
        owner = owner_;
        guardian = guardian_;
        agent = agent_;
        USDC = IMandateFactory(msg.sender).usdc();
        NATIVE_IS_USDC = IMandateFactory(msg.sender).nativeIsUsdc();
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Agent entry points
    // ---------------------------------------------------------------------------------------------

    /// @notice Execute a plan step that stays inside the mandate. Reverts if any call needs the guardian or
    ///         if the measured USDC outflow breaks the per-tx or daily cap.
    function execute(Call[] calldata calls, bytes32 planId, uint8 step) external onlyAgent nonReentrant {
        Mandate memory m = _activeMandate();
        _checkAllowed(calls, true);

        uint256 spent = _runMeasured(calls);

        if (spent > m.perTxCap) revert PerTxCapExceeded(spent, m.perTxCap);
        _rollWindow();
        uint256 newDaily = uint256(dailySpent) + spent;
        if (newDaily > m.dailyCap) revert DailyCapExceeded(newDaily, m.dailyCap);
        dailySpent = uint128(newDaily);

        emit StepExecuted(planId, step, spent, keccak256(abi.encode(calls)), false);
    }

    /// @notice Execute a plan step that the guardian has approved on a hardware wallet. Caps and the
    ///         `requiresGuardian` flag are bypassed; the allow-list is not. `maxUsdcOut` is the figure the
    ///         human saw on the device and is binding.
    function executeWithGuardian(
        Call[] calldata calls,
        uint256 maxUsdcOut,
        bytes32 planId,
        uint8 step,
        uint64 deadline,
        bytes calldata signature
    ) external onlyAgent nonReentrant {
        _activeMandate();
        _checkAllowed(calls, false);

        bytes32 callsHash = keccak256(abi.encode(calls));
        _consumeGuardianApproval(planId, step, maxUsdcOut, callsHash, deadline, signature);

        uint256 spent = _runMeasured(calls);
        if (spent > maxUsdcOut) revert MaxOutExceeded(spent, maxUsdcOut);

        emit StepExecuted(planId, step, spent, callsHash, true);
    }

    /// @notice The exact text the guardian signs (EIP-191 personal_sign). Fixed field order, lowercase hex,
    ///         USDC rendered with 6 decimals. Clients must reproduce it byte for byte.
    function approvalText(
        bytes32 planId,
        uint8 step,
        uint256 maxUsdcOut,
        bytes32 callsHash,
        uint64 deadline,
        uint256 nonce
    ) public view returns (string memory) {
        return string.concat(
            "Mandate approval\n",
            "Account: ", Strings.toHexString(address(this)), "\n",
            "Chain: ", Strings.toString(block.chainid), "\n",
            "Plan: ", Strings.toHexString(uint256(planId), 32), "\n",
            "Step: ", Strings.toString(step), "\n",
            "Max USDC out: ", _formatUsdc(maxUsdcOut), "\n",
            "Calls: ", Strings.toHexString(uint256(callsHash), 32), "\n",
            "Deadline: ", Strings.toString(deadline), "\n",
            "Nonce: ", Strings.toString(nonce)
        );
    }

    // ---------------------------------------------------------------------------------------------
    // Repayment intents (follow-through)
    // ---------------------------------------------------------------------------------------------

    function scheduleRepayment(uint64 dueAt, uint128 amount, address venue) external returns (uint256 id) {
        if (msg.sender != owner && msg.sender != agent) revert NotOwnerOrAgent();
        if (dueAt <= block.timestamp || amount == 0) revert InvalidRepayment();
        id = repayments.length;
        repayments.push(Repayment({dueAt: dueAt, amount: amount, venue: venue, done: false}));
        emit RepaymentScheduled(id, dueAt, amount, venue);
    }

    function markRepaid(uint256 id) external {
        if (msg.sender != owner && msg.sender != agent) revert NotOwnerOrAgent();
        if (id >= repayments.length || repayments[id].done) revert InvalidRepayment();
        repayments[id].done = true;
        emit RepaymentDone(id);
    }

    function repaymentCount() external view returns (uint256) {
        return repayments.length;
    }

    // ---------------------------------------------------------------------------------------------
    // Owner administration
    // ---------------------------------------------------------------------------------------------

    function setMandate(uint128 perTxCap, uint128 dailyCap, uint64 expiry) external onlyOwner {
        mandate = Mandate({perTxCap: perTxCap, dailyCap: dailyCap, expiry: expiry});
        emit MandateUpdated(perTxCap, dailyCap, expiry);
    }

    function revokeMandate() external onlyOwner {
        delete mandate;
        emit MandateUpdated(0, 0, 0);
    }

    function setPolicy(address target, bytes4 selector, bool allowed, bool requiresGuardian) external onlyOwner {
        _setPolicy(target, selector, allowed, requiresGuardian);
    }

    function setPolicies(PolicyInput[] calldata inputs) external onlyOwner {
        for (uint256 i; i < inputs.length; ++i) {
            _setPolicy(inputs[i].target, inputs[i].selector, inputs[i].allowed, inputs[i].requiresGuardian);
        }
    }

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert ZeroAddress();
        agent = agent_;
        emit AgentUpdated(agent_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }

    function transferOwnership(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerUpdated(owner_);
    }

    /// @notice Owner escape hatch: move any token out of the account.
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function withdrawNative(address to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert CallFailed(0, "");
    }

    /// @notice Owner may execute anything directly (this is the owner's account).
    function ownerExecute(Call[] calldata calls) external onlyOwner nonReentrant {
        _run(calls);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice Remaining daily allowance as of now (accounts for window rollover).
    function dailyRemaining() external view returns (uint256) {
        Mandate memory m = mandate;
        if (block.timestamp >= uint256(windowStart) + 1 days) return m.dailyCap;
        return m.dailyCap > dailySpent ? m.dailyCap - dailySpent : 0;
    }

    function policyFor(address target, bytes4 selector) external view returns (Policy memory) {
        Policy memory p = policies[target][selector];
        if (!p.allowed) p = policies[address(0)][selector];
        return p;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _activeMandate() internal view returns (Mandate memory m) {
        m = mandate;
        if (m.expiry == 0) revert MandateInactive();
        if (block.timestamp > m.expiry) revert MandateExpired();
    }

    function _checkAllowed(Call[] calldata calls, bool rejectGuardianFlag) internal view {
        for (uint256 i; i < calls.length; ++i) {
            Policy memory p = _policyFor(calls[i]);
            if (!p.allowed) revert CallNotAllowed(calls[i].target, _selector(calls[i].data));
            if (rejectGuardianFlag && p.requiresGuardian) {
                revert GuardianRequired(calls[i].target, _selector(calls[i].data));
            }
        }
    }

    function _consumeGuardianApproval(
        bytes32 planId,
        uint8 step,
        uint256 maxUsdcOut,
        bytes32 callsHash,
        uint64 deadline,
        bytes calldata signature
    ) internal {
        if (guardian == address(0)) revert NoGuardian();
        if (block.timestamp > deadline) revert ApprovalExpired();
        uint256 nonce = guardianNonce;
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            bytes(approvalText(planId, step, maxUsdcOut, callsHash, deadline, nonce))
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != guardian) revert BadGuardianSignature();
        guardianNonce = nonce + 1;
        emit GuardianApproved(planId, step, signer, nonce);
    }

    /// @dev Runs the calls and returns the measured USDC outflow (0 if the balance grew).
    function _runMeasured(Call[] calldata calls) internal returns (uint256 spent) {
        uint256 before = _usdcBalance();
        _run(calls);
        uint256 after_ = _usdcBalance();
        spent = after_ >= before ? 0 : before - after_;
    }

    function _setPolicy(address target, bytes4 selector, bool allowed, bool requiresGuardian) internal {
        policies[target][selector] = Policy({allowed: allowed, requiresGuardian: requiresGuardian});
        emit PolicyUpdated(target, selector, allowed, requiresGuardian);
    }

    function _policyFor(Call calldata c) internal view returns (Policy memory p) {
        bytes4 sel = _selector(c.data);
        p = policies[c.target][sel];
        if (!p.allowed) p = policies[address(0)][sel];
    }

    function _selector(bytes calldata data) internal pure returns (bytes4) {
        return data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
    }

    function _run(Call[] calldata calls) internal {
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }
    }

    /// @dev USDC-denominated balance of this account in 6-dec units, incl. native when native is USDC.
    function _usdcBalance() internal view returns (uint256 bal) {
        bal = IERC20(USDC).balanceOf(address(this));
        if (NATIVE_IS_USDC) bal += address(this).balance / 1e12;
    }

    function _rollWindow() internal {
        if (block.timestamp >= uint256(windowStart) + 1 days) {
            windowStart = uint64(block.timestamp);
            dailySpent = 0;
        }
    }

    function _formatUsdc(uint256 amount) internal pure returns (string memory) {
        uint256 whole = amount / 1e6;
        uint256 frac = amount % 1e6;
        bytes memory f = bytes(Strings.toString(frac));
        bytes memory padded = new bytes(6);
        uint256 lead = 6 - f.length;
        for (uint256 i; i < 6; ++i) {
            padded[i] = i < lead ? bytes1("0") : f[i - lead];
        }
        return string.concat(Strings.toString(whole), ".", string(padded));
    }
}
