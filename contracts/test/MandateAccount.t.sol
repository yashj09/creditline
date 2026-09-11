// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {MandateFactory} from "../src/MandateFactory.sol";
import {MockUSDC, MockVenue, MockBridge, MockReenter} from "./mocks/Mocks.sol";

contract MandateAccountTest is Test {
    MandateFactory factory;
    MandateAccount acct;
    MockUSDC usdc;
    MockVenue venue;
    MockBridge bridge;

    address deployer = makeAddr("deployer");
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address recipient = makeAddr("recipient");
    uint256 guardianPk = 0xA11CE;
    address guardian;
    bytes32 salt = keccak256("demo");

    uint128 constant PER_TX = 100e6;
    uint128 constant DAILY = 250e6;

    function setUp() public {
        guardian = vm.addr(guardianPk);
        usdc = new MockUSDC();
        venue = new MockVenue(usdc);
        bridge = new MockBridge(usdc);

        vm.startPrank(deployer);
        factory = new MandateFactory(deployer);
        factory.configure(address(usdc), false);
        vm.stopPrank();

        address predicted = factory.computeAddress(owner, guardian, agent, salt);
        acct = MandateAccount(payable(factory.createAccount(owner, guardian, agent, salt)));
        assertEq(address(acct), predicted, "create2 address");

        usdc.mint(address(acct), 1_000e6);

        vm.startPrank(owner);
        acct.setMandate(PER_TX, DAILY, uint64(block.timestamp + 7 days));
        acct.setPolicy(address(usdc), IERC20.transfer.selector, true, false); // test-only: direct spend w/o guardian
        acct.setPolicy(address(usdc), IERC20.approve.selector, true, false);
        acct.setPolicy(address(venue), MockVenue.borrow.selector, true, false);
        acct.setPolicy(address(venue), MockVenue.repay.selector, true, false);
        acct.setPolicy(address(bridge), MockBridge.burn.selector, true, true); // irreversible → guardian
        acct.setPolicy(address(0), bytes4(0), true, true); // wildcard native transfer → guardian
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _transfer(address to, uint256 amount) internal view returns (MandateAccount.Call[] memory c) {
        c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _sign(MandateAccount.Call[] memory calls, uint256 maxOut, bytes32 planId, uint8 step, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        string memory text =
            acct.approvalText(planId, step, maxOut, keccak256(abi.encode(calls)), deadline, acct.guardianNonce());
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(text));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ execute

    function test_execute_withinCaps_spendsAndTracks() public {
        vm.prank(agent);
        acct.execute(_transfer(recipient, 60e6), bytes32("p1"), 1);
        assertEq(usdc.balanceOf(recipient), 60e6);
        assertEq(acct.dailySpent(), 60e6);
        assertEq(acct.dailyRemaining(), DAILY - 60e6);
    }

    function test_execute_revertsForNonAgent() public {
        vm.prank(owner);
        vm.expectRevert(MandateAccount.NotAgent.selector);
        acct.execute(_transfer(recipient, 1e6), bytes32("p"), 1);
    }

    function test_execute_revertsWhenTargetNotAllowed() public {
        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(usdc), 0, abi.encodeCall(IERC20.transferFrom, (owner, recipient, 1)));
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateAccount.CallNotAllowed.selector, address(usdc), IERC20.transferFrom.selector)
        );
        acct.execute(c, bytes32("p"), 1);
    }

    function test_execute_revertsWhenGuardianRequired() public {
        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(bridge), 0, abi.encodeCall(MockBridge.burn, (1e6, 26)));
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateAccount.GuardianRequired.selector, address(bridge), MockBridge.burn.selector)
        );
        acct.execute(c, bytes32("p"), 1);
    }

    function test_execute_revertsOverPerTxCap() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.PerTxCapExceeded.selector, PER_TX + 1, PER_TX));
        acct.execute(_transfer(recipient, PER_TX + 1), bytes32("p"), 1);
    }

    function test_execute_dailyCapAccumulatesAndRollsOver() public {
        vm.startPrank(agent);
        acct.execute(_transfer(recipient, 100e6), bytes32("p"), 1);
        acct.execute(_transfer(recipient, 100e6), bytes32("p"), 2);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.DailyCapExceeded.selector, 300e6, DAILY));
        acct.execute(_transfer(recipient, 100e6), bytes32("p"), 3);
        assertEq(acct.dailyRemaining(), 50e6);

        vm.warp(block.timestamp + 1 days);
        assertEq(acct.dailyRemaining(), DAILY);
        acct.execute(_transfer(recipient, 100e6), bytes32("p"), 3);
        assertEq(acct.dailySpent(), 100e6);
        vm.stopPrank();
    }

    function test_execute_inflowDoesNotCountAsSpend() public {
        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(venue), 0, abi.encodeCall(MockVenue.borrow, (5_000e6))); // way over caps
        vm.prank(agent);
        acct.execute(c, bytes32("p"), 1);
        assertEq(acct.dailySpent(), 0);
        assertEq(usdc.balanceOf(address(acct)), 6_000e6);
    }

    function test_execute_measuresGrossOutflow_inflowsDoNotOffset() public {
        // borrow 500 then send 90 → the 90 is a real outflow and must count, even though the step nets positive
        MandateAccount.Call[] memory c = new MandateAccount.Call[](2);
        c[0] = MandateAccount.Call(address(venue), 0, abi.encodeCall(MockVenue.borrow, (500e6)));
        c[1] = MandateAccount.Call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 90e6)));
        vm.prank(agent);
        acct.execute(c, bytes32("p"), 1);
        assertEq(acct.dailySpent(), 90e6);

        // and an over-cap payment hidden behind a borrow is still rejected
        c[1] = MandateAccount.Call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, PER_TX + 1)));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.PerTxCapExceeded.selector, PER_TX + 1, PER_TX));
        acct.execute(c, bytes32("p"), 2);
    }

    function test_execute_stepCannotRunTwice() public {
        vm.startPrank(agent);
        acct.execute(_transfer(recipient, 1e6), bytes32("p"), 1);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.StepAlreadyExecuted.selector, bytes32("p"), uint8(1)));
        acct.execute(_transfer(recipient, 1e6), bytes32("p"), 1);
        acct.execute(_transfer(recipient, 1e6), bytes32("p"), 2); // next step fine
        acct.execute(_transfer(recipient, 1e6), bytes32("q"), 1); // other plan fine
        vm.stopPrank();
        assertTrue(acct.executed(bytes32("p"), 1));
        assertFalse(acct.executed(bytes32("p"), 3));
    }

    function test_guardian_stepCannotRunTwiceEvenWithFreshSignature() public {
        MandateAccount.Call[] memory c = _transfer(recipient, 200e6);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig1 = _sign(c, 200e6, bytes32("p"), 1, deadline);
        vm.prank(agent);
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 1, deadline, sig1);
        bytes memory sig2 = _sign(c, 200e6, bytes32("p"), 1, deadline); // new nonce, same step
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.StepAlreadyExecuted.selector, bytes32("p"), uint8(1)));
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 1, deadline, sig2);
    }

    function test_policy_explicitDenyOverridesWildcard() public {
        // wildcard allows native transfers (guardian); deny one specific recipient
        address blocked = makeAddr("blocked");
        vm.deal(address(acct), 1 ether);
        vm.startPrank(owner);
        acct.setPolicy(address(0), bytes4(0), true, false); // test-only: wildcard native w/o guardian
        acct.setPolicy(blocked, bytes4(0), false, false); // explicit deny
        vm.stopPrank();

        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(blocked, 0.1 ether, "");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.CallNotAllowed.selector, blocked, bytes4(0)));
        acct.execute(c, bytes32("p"), 1);

        c[0] = MandateAccount.Call(recipient, 0.1 ether, ""); // anyone else still allowed via wildcard
        vm.prank(agent);
        acct.execute(c, bytes32("p"), 2);

        vm.prank(owner);
        acct.clearPolicy(blocked, bytes4(0)); // back to wildcard
        c[0] = MandateAccount.Call(blocked, 0.1 ether, "");
        vm.prank(agent);
        acct.execute(c, bytes32("p"), 3);
    }

    function test_execute_revertsWhenExpired() public {
        vm.warp(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(MandateAccount.MandateExpired.selector);
        acct.execute(_transfer(recipient, 1e6), bytes32("p"), 1);
    }

    function test_execute_revertsWhenRevoked() public {
        vm.prank(owner);
        acct.revokeMandate();
        vm.prank(agent);
        vm.expectRevert(MandateAccount.MandateInactive.selector);
        acct.execute(_transfer(recipient, 1e6), bytes32("p"), 1);
    }

    function test_execute_bubblesInnerRevert() public {
        vm.prank(agent);
        vm.expectRevert(); // CallFailed with ERC20InsufficientBalance payload
        acct.execute(_transfer(recipient, 5_000e6), bytes32("p"), 1);
    }

    // ------------------------------------------------------------------ guardian

    function test_guardian_approvesOverCapAndIrreversible() public {
        MandateAccount.Call[] memory c = new MandateAccount.Call[](2);
        c[0] = MandateAccount.Call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(bridge), 400e6)));
        c[1] = MandateAccount.Call(address(bridge), 0, abi.encodeCall(MockBridge.burn, (400e6, 26)));
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(c, 400e6, bytes32("p"), 3, deadline);

        vm.expectEmit(true, true, false, true);
        emit MandateAccount.GuardianApproved(bytes32("p"), 3, guardian, 0);
        vm.prank(agent);
        acct.executeWithGuardian(c, 400e6, bytes32("p"), 3, deadline, sig);

        assertEq(usdc.balanceOf(address(acct)), 600e6);
        assertEq(acct.guardianNonce(), 1);
        assertEq(acct.dailySpent(), 0, "guardian-approved spend does not consume daily cap");
    }

    function test_guardian_rejectsWrongSigner() public {
        MandateAccount.Call[] memory c = _transfer(recipient, 200e6);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        string memory text = acct.approvalText(bytes32("p"), 1, 200e6, keccak256(abi.encode(c)), deadline, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, MessageHashUtils.toEthSignedMessageHash(bytes(text)));
        vm.prank(agent);
        vm.expectRevert(MandateAccount.BadGuardianSignature.selector);
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 1, deadline, abi.encodePacked(r, s, v));
    }

    function test_guardian_signatureCannotBeReplayed() public {
        MandateAccount.Call[] memory c = _transfer(recipient, 200e6);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(c, 200e6, bytes32("p"), 1, deadline);
        vm.startPrank(agent);
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 1, deadline, sig);
        // same step: blocked by the per-step guard before any signature work
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.StepAlreadyExecuted.selector, bytes32("p"), uint8(1)));
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 1, deadline, sig);
        // different step, old signature: nonce moved → signature no longer recovers to the guardian
        vm.expectRevert(MandateAccount.BadGuardianSignature.selector);
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 2, deadline, sig);
        vm.stopPrank();
    }

    function test_guardian_rejectsExpiredApproval() public {
        MandateAccount.Call[] memory c = _transfer(recipient, 200e6);
        uint64 deadline = uint64(block.timestamp + 1);
        bytes memory sig = _sign(c, 200e6, bytes32("p"), 1, deadline);
        vm.warp(block.timestamp + 2);
        vm.prank(agent);
        vm.expectRevert(MandateAccount.ApprovalExpired.selector);
        acct.executeWithGuardian(c, 200e6, bytes32("p"), 1, deadline, sig);
    }

    function test_guardian_approvedMaxIsBinding() public {
        // human approved 150 but the calls actually move 200 → revert
        MandateAccount.Call[] memory c = _transfer(recipient, 200e6);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(c, 150e6, bytes32("p"), 1, deadline);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.MaxOutExceeded.selector, 200e6, 150e6));
        acct.executeWithGuardian(c, 150e6, bytes32("p"), 1, deadline, sig);
    }

    function test_guardian_cannotBypassAllowlist() public {
        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(usdc), 0, abi.encodeCall(IERC20.transferFrom, (owner, recipient, 1)));
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(c, 1, bytes32("p"), 1, deadline);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateAccount.CallNotAllowed.selector, address(usdc), IERC20.transferFrom.selector)
        );
        acct.executeWithGuardian(c, 1, bytes32("p"), 1, deadline, sig);
    }

    function test_guardian_requiredWhenNoneSet() public {
        vm.prank(owner);
        acct.setGuardian(address(0));
        MandateAccount.Call[] memory c = _transfer(recipient, 1e6);
        vm.prank(agent);
        vm.expectRevert(MandateAccount.NoGuardian.selector);
        acct.executeWithGuardian(c, 1e6, bytes32("p"), 1, uint64(block.timestamp + 1), "");
    }

    function test_approvalText_isDeterministicAndReadable() public view {
        string memory text = acct.approvalText(
            bytes32(uint256(0xabc)), 3, 500_250_000, bytes32(uint256(0x1234)), 1_757_000_000, 7
        );
        string memory expected = string.concat(
            "Mandate approval\n",
            "Account: ", vm.toLowercase(vm.toString(address(acct))), "\n",
            "Chain: ", vm.toString(block.chainid), "\n",
            "Plan: 0x0000000000000000000000000000000000000000000000000000000000000abc\n",
            "Step: 3\n",
            "Max USDC out: 500.250000\n",
            "Calls: 0x0000000000000000000000000000000000000000000000000000000000001234\n",
            "Deadline: 1757000000\n",
            "Nonce: 7"
        );
        assertEq(text, expected);
    }

    // ------------------------------------------------------------------ native-as-USDC (Arc)

    function test_nativeIsUsdc_countsNativeOutflow() public {
        vm.startPrank(deployer);
        MandateFactory f2 = new MandateFactory(deployer);
        f2.configure(address(usdc), true);
        vm.stopPrank();
        MandateAccount a2 = MandateAccount(payable(f2.createAccount(owner, guardian, agent, salt)));
        vm.deal(address(a2), 1_000e18); // 1000 USDC as 18-dec native
        vm.startPrank(owner);
        a2.setMandate(PER_TX, DAILY, uint64(block.timestamp + 1 days));
        a2.setPolicy(recipient, bytes4(0), true, false); // test-only: native pay w/o guardian
        vm.stopPrank();

        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(recipient, 80e18, "");
        vm.prank(agent);
        a2.execute(c, bytes32("p"), 1);
        assertEq(a2.dailySpent(), 80e6);

        c[0] = MandateAccount.Call(recipient, 101e18, "");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.PerTxCapExceeded.selector, 101e6, PER_TX));
        a2.execute(c, bytes32("p"), 2);
    }

    // ------------------------------------------------------------------ admin & misc

    function test_onlyOwnerSetters() public {
        vm.startPrank(agent);
        vm.expectRevert(MandateAccount.NotOwner.selector);
        acct.setMandate(1, 1, 1);
        vm.expectRevert(MandateAccount.NotOwner.selector);
        acct.setPolicy(address(1), bytes4(0), true, false);
        vm.expectRevert(MandateAccount.NotOwner.selector);
        acct.setAgent(address(1));
        vm.expectRevert(MandateAccount.NotOwner.selector);
        acct.withdrawToken(address(usdc), agent, 1);
        vm.stopPrank();
    }

    function test_ownerCanWithdrawAnything() public {
        vm.prank(owner);
        acct.withdrawToken(address(usdc), owner, 1_000e6);
        assertEq(usdc.balanceOf(owner), 1_000e6);
    }

    function test_repaymentLifecycle() public {
        vm.prank(agent);
        uint256 id = acct.scheduleRepayment(uint64(block.timestamp + 3 days), 500e6, address(venue));
        assertEq(id, 0);
        assertEq(acct.repaymentCount(), 1);
        vm.prank(owner);
        acct.markRepaid(0);
        (,,, bool done) = acct.repayments(0);
        assertTrue(done);
        vm.prank(agent);
        vm.expectRevert(MandateAccount.InvalidRepayment.selector);
        acct.markRepaid(0);
    }

    function test_reentrancyBlocked() public {
        MockReenter re = new MockReenter();
        re.setAccount(address(acct));
        vm.prank(owner);
        acct.setPolicy(address(re), MockReenter.poke.selector, true, false);
        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(re), 0, abi.encodeCall(MockReenter.poke, ()));
        vm.prank(agent);
        vm.expectRevert(); // inner ownerExecute reverts (NotOwner / reentrancy) → CallFailed
        acct.execute(c, bytes32("p"), 1);
    }

    function test_factory_configureOnce() public {
        vm.startPrank(deployer);
        vm.expectRevert(MandateFactory.AlreadyConfigured.selector);
        factory.configure(address(usdc), false);
        vm.stopPrank();
        vm.expectRevert(MandateFactory.NotDeployer.selector);
        factory.configure(address(usdc), false);
    }
}
