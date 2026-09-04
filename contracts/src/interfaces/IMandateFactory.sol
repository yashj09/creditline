// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMandateFactory {
    function usdc() external view returns (address);
    function nativeIsUsdc() external view returns (bool);
}
