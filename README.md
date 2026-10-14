# solidity-vault

> ERC-4626 tokenized vault with a strategy hook, written in Solidity 0.8.27.

[![CI](https://github.com/rehansaeedjutt-rgb/solidity-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/rehansaeedjutt-rgb/solidity-vault/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.27-blue.svg)](https://soliditylang.org/)

## What this is

`solidity-vault` is a small, honest ERC-4626 implementation with a pluggable
strategy hook. Deposits sit idle by default. The owner can deploy idle assets
to a strategy and recall them later. `totalAssets()` accounts for both idle
and deployed capital, so the share-price math behaves as expected.

This is the same shape of contract that DeFi protocols use for vault products:
Yearn, Beefy, and every yield aggregator implement some variation of it.
The point of this project was to write one from scratch, understand every
line, and test the failure modes honestly.

## Live demo (local)

Run the full deploy + demo cycle on a local Hardhat node:

    npx hardhat node              # Terminal 1
    npx hardhat run scripts/deploy.ts --network localhost   # Terminal 2

Example output:

    Deploying to localhost
    Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    Balance:  10000.0 ETH

    MockUSDC:   0x5FbDB2315678afecb367f032d93F642f64180aa3
    SimpleVault: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
    Minted 1000000 mUSDC to deployer

    Addresses written to deployments/localhost.json

## What is in here

- **SimpleVault.sol** — ERC-4626 implementation built on OpenZeppelin v5.
- **IVaultStrategy.sol** — three-method interface a strategy must implement.
- **MockERC20.sol** — test-only ERC-20 with public mint.
- **MockStrategy.sol** — test-only strategy that holds assets and can be told
  to report fake yield for testing.
- **18 tests** covering deposits, withdrawals, strategy deploy/recall, ownership,
  and yield reflection.
- **Deploy script** that writes contract addresses to a JSON file.
- **GitHub Actions CI** on Node 22.

## What is NOT here (deliberately)

- **No auto-recall on withdraw.** If all assets are in the strategy, a user
  cannot withdraw until the owner recalls them first. This is a real limitation.
  A production vault would override `_withdraw` to pull from the strategy
  automatically, but that adds reentrancy considerations, strategy failure
  handling, and withdrawal queues. I chose the simpler and more honest version.
- **No timelock on owner actions.** The owner can change the strategy or move
  assets instantly. A real product would put this behind a governance timelock
  or a multisig.
- **No fees.** No management fee, no performance fee. Adding them is
  straightforward but requires a fee-recipient design.
- **Not deployed to Sepolia yet.** The deploy script works, but I have not
  pushed it to a public testnet. That is a next step, not a claim.

## Architecture

    User ---- deposit() ----> +------------------+
                              |    SimpleVault   |
                              |  (ERC-4626)      |
                              +------------------+
                                      |
                                      | deployToStrategy() / recallFromStrategy()
                                      v
                              +------------------+
                              |  IVaultStrategy  |
                              +------------------+
                                      |
                                      | strategy-specific yield logic
                                      v
                              underlying DeFi protocol
                              (Aave, Compound, LPs, etc.)

The vault does not know anything about yield. It is a bucket. The strategy
does the actual work.

## Install and test

    git clone https://github.com/rehansaeedjutt-rgb/solidity-vault.git
    cd solidity-vault
    npm install
    npx hardhat compile
    npx hardhat test

Tests should print:

    18 passing

## Design notes

**Why OpenZeppelin v5.** The v5 release uses the Cancun MCOPY opcode, which
requires `evmVersion: "cancun"` in the Hardhat config. This is set. Sepolia
supports Cancun, so the same config works for deployment.

**Why the vault does not auto-recall.** The alternative is to override
`_withdraw` and call `strategy.recall()` from inside. That sounds clean until
you consider what happens if the strategy fails, or if a malicious strategy
reenters the vault during a recall. Rather than build a half-correct version,
I built the version that is honest about its limits.

**Why `setStrategy` refuses while assets are deployed.** A strategy change
should not silently strand assets. The owner has to recall first, then swap.
This is a deliberate friction.

**Why `forceApprove` instead of `approve`.** Some ERC-20 tokens (USDT) do
not return a boolean from `approve`. `forceApprove` handles both cases.

## Roadmap

- [ ] Deploy to Sepolia and verify on Etherscan
- [ ] `_withdraw` override with strategy auto-recall
- [ ] Timelock controller behind owner functions
- [ ] Performance fee + management fee
- [ ] Integration test against a forked Aave v3 pool
- [ ] Frontend (Next.js) for deposit/withdraw

## Disclaimer

Educational project. Not audited. Do not deploy to mainnet with real funds.

## License

MIT — see [LICENSE](LICENSE).

## Author

**Muhammad Rehan Saeed** — [GitHub](https://github.com/rehansaeedjutt-rgb)