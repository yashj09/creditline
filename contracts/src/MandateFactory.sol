// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateAccount} from "./MandateAccount.sol";

/// @title MandateFactory
/// @notice Deploys MandateAccounts with CREATE2 so a user gets the same account address on every chain
///         (Base Sepolia for borrowing, Arc for settlement). Chain-specific USDC config lives here, not in
///         the account init code, precisely so the init code hash is identical everywhere.
contract MandateFactory {
    address public immutable deployer;
    address public usdc;
    bool public nativeIsUsdc;
    bool public configured;

    event Configured(address usdc, bool nativeIsUsdc);
    event AccountCreated(address indexed account, address indexed owner, address guardian, address agent, bytes32 salt);

    error NotDeployer();
    error AlreadyConfigured();
    error NotConfigured();

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time chain configuration by the deployer. Kept out of the constructor so the factory's own
    ///         CREATE2 address matches across chains too.
    function configure(address usdc_, bool nativeIsUsdc_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (configured) revert AlreadyConfigured();
        usdc = usdc_;
        nativeIsUsdc = nativeIsUsdc_;
        configured = true;
        emit Configured(usdc_, nativeIsUsdc_);
    }

    function createAccount(address owner, address guardian, address agent, bytes32 salt)
        external
        returns (address account)
    {
        if (!configured) revert NotConfigured();
        account = address(new MandateAccount{salt: salt}(owner, guardian, agent));
        emit AccountCreated(account, owner, guardian, agent, salt);
    }

    function computeAddress(address owner, address guardian, address agent, bytes32 salt)
        external
        view
        returns (address)
    {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(MandateAccount).creationCode, abi.encode(owner, guardian, agent)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
