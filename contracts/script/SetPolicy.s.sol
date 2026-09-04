// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {ITokenMessengerV2} from "../src/interfaces/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../src/interfaces/IMessageTransmitterV2.sol";

/// @notice Applies the default demo mandate + policy to an account, as the owner.
///         Reversible protocol interactions are agent-only; anything that sends value away is guardian-gated.
///
/// Env: OWNER_PRIVATE_KEY, ACCOUNT, optional PER_TX_CAP / DAILY_CAP (USDC 6-dec) / EXPIRY_DAYS.
contract SetPolicy is Script {
    address constant TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address constant MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    function run() external {
        uint256 pk = vm.envUint("OWNER_PRIVATE_KEY");
        MandateAccount acct = MandateAccount(payable(vm.envAddress("ACCOUNT")));
        uint128 perTx = uint128(vm.envOr("PER_TX_CAP", uint256(100e6)));
        uint128 daily = uint128(vm.envOr("DAILY_CAP", uint256(500e6)));
        uint64 expiry = uint64(block.timestamp + vm.envOr("EXPIRY_DAYS", uint256(7)) * 1 days);

        MandateAccount.PolicyInput[] memory p = _policy(acct.USDC());

        vm.startBroadcast(pk);
        acct.setMandate(perTx, daily, expiry);
        acct.setPolicies(p);
        vm.stopBroadcast();
        console2.log("policy applied to", address(acct), "entries:", p.length);
    }

    function _policy(address usdc) internal view returns (MandateAccount.PolicyInput[] memory p) {
        if (block.chainid == 84532) {
            address comet = 0x571621Ce60Cebb0c1D442B5afb38B1663C6Bf017;
            address weth = 0x4200000000000000000000000000000000000006;
            p = new MandateAccount.PolicyInput[](8);
            p[0] = MandateAccount.PolicyInput(weth, IWETH.deposit.selector, true, false);
            p[1] = MandateAccount.PolicyInput(weth, IERC20.approve.selector, true, false);
            p[2] = MandateAccount.PolicyInput(comet, IComet.supply.selector, true, false); // supply collateral / repay
            p[3] = MandateAccount.PolicyInput(comet, IComet.withdraw.selector, true, false); // borrow / withdraw collateral
            p[4] = MandateAccount.PolicyInput(usdc, IERC20.approve.selector, true, false);
            p[5] = MandateAccount.PolicyInput(TOKEN_MESSENGER, ITokenMessengerV2.depositForBurn.selector, true, true);
            p[6] = MandateAccount.PolicyInput(usdc, IERC20.transfer.selector, true, true);
            p[7] = MandateAccount.PolicyInput(MESSAGE_TRANSMITTER, IMessageTransmitterV2.receiveMessage.selector, true, false);
        } else if (block.chainid == 5042002 || block.chainid == 5042) {
            p = new MandateAccount.PolicyInput[](5);
            p[0] = MandateAccount.PolicyInput(MESSAGE_TRANSMITTER, IMessageTransmitterV2.receiveMessage.selector, true, false);
            p[1] = MandateAccount.PolicyInput(usdc, IERC20.approve.selector, true, false);
            p[2] = MandateAccount.PolicyInput(usdc, IERC20.transfer.selector, true, true); // pay a third party
            p[3] = MandateAccount.PolicyInput(address(0), bytes4(0), true, true); // native USDC transfer to anyone
            p[4] = MandateAccount.PolicyInput(TOKEN_MESSENGER, ITokenMessengerV2.depositForBurn.selector, true, true); // bridge back
        } else {
            revert("unsupported chain");
        }
    }
}
