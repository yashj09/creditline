// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Circle CCTP v2 TokenMessenger (same address on every EVM testnet, incl. Arc).
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    function localMessageTransmitter() external view returns (address);
}
