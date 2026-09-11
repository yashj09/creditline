import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const wethAbi = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const cometAbi = parseAbi([
  "struct AssetInfo { uint8 offset; address asset; address priceFeed; uint64 scale; uint64 borrowCollateralFactor; uint64 liquidateCollateralFactor; uint64 liquidationFactor; uint128 supplyCap; }",
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function baseToken() view returns (address)",
  "function baseTokenPriceFeed() view returns (address)",
  "function borrowBalanceOf(address account) view returns (uint256)",
  "function collateralBalanceOf(address account, address asset) view returns (uint128)",
  "function getAssetInfoByAddress(address asset) view returns (AssetInfo)",
  "function getPrice(address priceFeed) view returns (uint256)",
  "function getUtilization() view returns (uint256)",
  "function getBorrowRate(uint256 utilization) view returns (uint64)",
  "function getSupplyRate(uint256 utilization) view returns (uint64)",
  "function isBorrowCollateralized(address account) view returns (bool)",
]);

export const tokenMessengerV2Abi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "event DepositForBurn(uint256 indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
]);

export const messageTransmitterV2Abi = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "function localDomain() view returns (uint32)",
  "function usedNonces(bytes32 nonce) view returns (uint256)",
  "event MessageSent(bytes message)",
]);
