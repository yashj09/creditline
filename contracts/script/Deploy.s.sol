// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MandateFactory} from "../src/MandateFactory.sol";
import {MandateAccount} from "../src/MandateAccount.sol";

/// @notice Deploys the factory deterministically (CREATE2 via the canonical deployer so the address matches on
///         every chain), configures it for the current chain, and creates the demo account.
///
/// Env: DEPLOYER_PRIVATE_KEY, OWNER_ADDRESS, GUARDIAN_ADDRESS, AGENT_ADDRESS, optional ACCOUNT_SALT, ARC_USDC.
/// Run:  forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
contract Deploy is Script {
    bytes32 constant FACTORY_SALT = keccak256("mandate.factory.v1");

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        bytes32 salt = vm.envOr("ACCOUNT_SALT", keccak256("mandate.demo.1"));

        (address usdc, bool nativeIsUsdc, string memory name) = _chainConfig();

        vm.startBroadcast(pk);
        MandateFactory factory = new MandateFactory{salt: FACTORY_SALT}();
        factory.configure(usdc, nativeIsUsdc);
        address account = factory.createAccount(owner, guardian, agent, salt);
        vm.stopBroadcast();

        console2.log("chain:", name);
        console2.log("factory:", address(factory));
        console2.log("account:", account);

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "account", account);
        vm.serializeAddress(json, "usdc", usdc);
        vm.serializeBool(json, "nativeIsUsdc", nativeIsUsdc);
        vm.serializeAddress(json, "owner", owner);
        vm.serializeAddress(json, "guardian", guardian);
        string memory out = vm.serializeAddress(json, "agent", agent);
        vm.writeJson(out, string.concat("deployments/", name, ".json"));
    }

    function _chainConfig() internal view returns (address usdc, bool nativeIsUsdc, string memory name) {
        if (block.chainid == 84532) return (0x036CbD53842c5426634e7929541eC2318f3dCF7e, false, "base-sepolia");
        if (block.chainid == 5042002) return (0x3600000000000000000000000000000000000000, true, "arc-testnet");
        if (block.chainid == 421614) return (0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d, false, "arb-sepolia");
        if (block.chainid == 5042) return (vm.envAddress("ARC_USDC"), true, "arc"); // mainnet: fill when published
        revert("unsupported chain");
    }
}
