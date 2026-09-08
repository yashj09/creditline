// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {MandateFactory} from "../src/MandateFactory.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {ITokenMessengerV2} from "../src/interfaces/ITokenMessengerV2.sol";

/// @notice Runs the real Day-2 path on a Base Sepolia fork: wrap ETH → supply WETH to Compound v3 → borrow
///         Circle USDC (all inside the mandate) → guardian-approved CCTP v2 burn towards Arc (domain 26).
///         Skipped unless BASE_SEPOLIA_RPC is set.
contract ForkCompoundTest is Test {
    // Base Sepolia (verified on-chain 2026-09-05)
    IComet constant COMET = IComet(0x571621Ce60Cebb0c1D442B5afb38B1663C6Bf017);
    IWETH constant WETH = IWETH(0x4200000000000000000000000000000000000006);
    IERC20 constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    ITokenMessengerV2 constant TOKEN_MESSENGER = ITokenMessengerV2(0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA);
    uint32 constant ARC_DOMAIN = 26;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    uint256 guardianPk = 0xA11CE;
    address guardian;

    MandateAccount acct;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        guardian = vm.addr(guardianPk);

        MandateFactory factory = new MandateFactory(address(this));
        factory.configure(address(USDC), false);
        acct = MandateAccount(payable(factory.createAccount(owner, guardian, agent, keccak256("fork"))));

        vm.startPrank(owner);
        acct.setMandate(100e6, 250e6, uint64(block.timestamp + 1 days));
        MandateAccount.PolicyInput[] memory p = new MandateAccount.PolicyInput[](6);
        p[0] = MandateAccount.PolicyInput(address(WETH), IWETH.deposit.selector, true, false);
        p[1] = MandateAccount.PolicyInput(address(WETH), IERC20.approve.selector, true, false);
        p[2] = MandateAccount.PolicyInput(address(COMET), IComet.supply.selector, true, false);
        p[3] = MandateAccount.PolicyInput(address(COMET), IComet.withdraw.selector, true, false);
        p[4] = MandateAccount.PolicyInput(address(USDC), IERC20.approve.selector, true, false);
        p[5] = MandateAccount.PolicyInput(address(TOKEN_MESSENGER), ITokenMessengerV2.depositForBurn.selector, true, true);
        acct.setPolicies(p);
        vm.stopPrank();

        vm.deal(address(acct), 1 ether);
    }

    function test_fork_supplyBorrowThenGuardedBridge() public {
        if (address(acct) == address(0)) {
            vm.skip(true);
            return;
        }

        // --- Step 1 (inside mandate): wrap, approve, supply 0.1 WETH, borrow 100 USDC -----------------
        MandateAccount.Call[] memory s1 = new MandateAccount.Call[](4);
        s1[0] = MandateAccount.Call(address(WETH), 0.1 ether, abi.encodeCall(IWETH.deposit, ()));
        s1[1] = MandateAccount.Call(address(WETH), 0, abi.encodeCall(IERC20.approve, (address(COMET), 0.1 ether)));
        s1[2] = MandateAccount.Call(address(COMET), 0, abi.encodeCall(IComet.supply, (address(WETH), 0.1 ether)));
        s1[3] = MandateAccount.Call(address(COMET), 0, abi.encodeCall(IComet.withdraw, (address(USDC), 100e6)));

        vm.prank(agent);
        acct.execute(s1, bytes32("plan"), 1);

        assertEq(USDC.balanceOf(address(acct)), 100e6, "borrowed USDC landed in account");
        assertEq(acct.dailySpent(), 0, "borrow is an inflow");
        assertApproxEqAbs(COMET.borrowBalanceOf(address(acct)), 100e6, 1, "comet debt");
        assertEq(COMET.collateralBalanceOf(address(acct), address(WETH)), 0.1 ether, "collateral");
        assertTrue(COMET.isBorrowCollateralized(address(acct)));
        console2.log("WETH price (8 dec):", COMET.getPrice(COMET.getAssetInfoByAddress(address(WETH)).priceFeed));

        // --- Step 2 (irreversible → guardian): CCTP burn 50 USDC towards the same account on Arc --------
        MandateAccount.Call[] memory s2 = new MandateAccount.Call[](2);
        s2[0] = MandateAccount.Call(address(USDC), 0, abi.encodeCall(IERC20.approve, (address(TOKEN_MESSENGER), 50e6)));
        s2[1] = MandateAccount.Call(
            address(TOKEN_MESSENGER),
            0,
            abi.encodeCall(
                ITokenMessengerV2.depositForBurn,
                (50e6, ARC_DOMAIN, bytes32(uint256(uint160(address(acct)))), address(USDC), bytes32(0), 1e5, 1000)
            )
        );

        // agent must not be able to do this alone
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateAccount.GuardianRequired.selector, address(TOKEN_MESSENGER), ITokenMessengerV2.depositForBurn.selector
            )
        );
        acct.execute(s2, bytes32("plan"), 2);

        uint64 deadline = uint64(block.timestamp + 10 minutes);
        string memory text = acct.approvalText(bytes32("plan"), 2, 50e6, keccak256(abi.encode(s2)), deadline, 0);
        console2.log("--- Ledger would display ---");
        console2.log(text);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianPk, MessageHashUtils.toEthSignedMessageHash(bytes(text)));

        vm.prank(agent);
        acct.executeWithGuardian(s2, 50e6, bytes32("plan"), 2, deadline, abi.encodePacked(r, s, v));

        assertEq(USDC.balanceOf(address(acct)), 50e6, "50 USDC burned into CCTP");
        assertEq(acct.guardianNonce(), 1);
    }
}
