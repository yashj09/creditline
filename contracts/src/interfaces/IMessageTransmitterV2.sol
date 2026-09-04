// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Circle CCTP v2 MessageTransmitter. `receiveMessage` is permissionless.
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
    function localDomain() external view returns (uint32);
}
