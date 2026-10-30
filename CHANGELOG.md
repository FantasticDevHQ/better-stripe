# Changelog

## Unreleased

- Add original affiliate commission obligations, exact reversal receipts,
  currency-scoped debt offsets before future transfers, receipt-backed dispute
  restoration, payout release reservations and paginated audit/migration APIs.
  Add authenticated example views, reusable React recovery components, scheduled
  reconciliation and simulated scenario/video evidence. Document actual provider
  restrictions and sandbox verification limits in the [clawback guide](docs/affiliate-clawbacks.md).
- Base split refund recovery on cumulative succeeded refunds, excluding pending
  and failed refunds from finalized obligations. Calculate affiliate dispute
  exposure from original gross charge principal, with deterministic integer
  rounding and an original-commission cap.

- Return every original split leg by default from `listTransfersByCharge`,
  excluding reinstatement rows before applying any explicit preview limit.
  Split breakdowns and reversal claims now cover sales with more than 50 legs.
  Atomic claims fail explicitly above 1,000 charge-linked transfer rows;
  queries also fail on Convex resource limits rather than silently truncate
  financial data. `listTransfersByAccount` remains a preview API;
  earnings hooks use exact server-side aggregates.
- Update the former roadmap to describe the existing product-level first-charge
  descriptors, first-invoice fee recovery, retry-safe reversal claims, and exact
  earnings aggregates, including their practical limitations.
- Remove internal tracker references from public documentation and add a
  regression check that prevents their reintroduction.

## [0.90.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.89.0...v0.90.0) (2026-10-30)


### Features

* **billing:** add internal raw renewal acquisition and lifecycle guards ([#418](https://github.com/FantasticDevHQ/better-stripe/issues/418)) ([40115d0](https://github.com/FantasticDevHQ/better-stripe/commit/40115d00a9a21c24c221434a98caf8d3617d115c))

## [0.89.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.88.1...v0.89.0) (2026-10-29)

### Features

- **billing:** add internal renewal owner and stock delegate ([#416](https://github.com/FantasticDevHQ/better-stripe/issues/416)) ([2ea0ec7](https://github.com/FantasticDevHQ/better-stripe/commit/2ea0ec770ae80111e8ce5dba3d1d6f8dceaae3d2))

## [0.88.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.88.0...v0.88.1) (2026-10-29)

### Bug Fixes

- **renewal:** retain complete raw provider snapshots ([#414](https://github.com/FantasticDevHQ/better-stripe/issues/414)) ([f963edc](https://github.com/FantasticDevHQ/better-stripe/commit/f963edc18512adf733872fe574a4f487237861a5))

## [0.88.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.87.0...v0.88.0) (2026-10-29)

### Features

- inspect V2 renewal schedule material ([#412](https://github.com/FantasticDevHQ/better-stripe/issues/412)) ([f009139](https://github.com/FantasticDevHQ/better-stripe/commit/f009139d2036b281a7a06f515cfd622e7c187c5f))

## [0.87.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.86.0...v0.87.0) (2026-10-29)

### Features

- bind V2 renewal configuration receipts ([#410](https://github.com/FantasticDevHQ/better-stripe/issues/410)) ([32fcb8c](https://github.com/FantasticDevHQ/better-stripe/commit/32fcb8c7b747818d40e81a6ba17110dedab40273))

## [0.86.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.85.0...v0.86.0) (2026-10-29)

### Features

- project V2 renewal configuration requests ([#408](https://github.com/FantasticDevHQ/better-stripe/issues/408)) ([fd0dac1](https://github.com/FantasticDevHQ/better-stripe/commit/fd0dac1806b12b8409669792ae4e8a36fe7c887e))

## [0.85.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.84.0...v0.85.0) (2026-10-29)

### Features

- add V2 renewal attachment receipts ([#406](https://github.com/FantasticDevHQ/better-stripe/issues/406)) ([573aee1](https://github.com/FantasticDevHQ/better-stripe/commit/573aee18d5e4502a1a28a1e1fb0f33b105638773))

## [0.84.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.83.1...v0.84.0) (2026-10-28)

### Features

- add compact V2 renewal request bindings ([#404](https://github.com/FantasticDevHQ/better-stripe/issues/404)) ([a64a33c](https://github.com/FantasticDevHQ/better-stripe/commit/a64a33cabf0f0894d100ab72d5d7754643621df1))

## [0.83.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.83.0...v0.83.1) (2026-10-27)

### Bug Fixes

- preserve renewal wire JSON and prevent redirect replay ([#402](https://github.com/FantasticDevHQ/better-stripe/issues/402)) ([481a902](https://github.com/FantasticDevHQ/better-stripe/commit/481a902a9182edd92f8dc0b01bf9e5c5892cf8f9))

## [0.83.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.82.0...v0.83.0) (2026-10-27)

### Features

- read bound renewal context and prepare attach requests ([#400](https://github.com/FantasticDevHQ/better-stripe/issues/400)) ([d0621ec](https://github.com/FantasticDevHQ/better-stripe/commit/d0621ec0e8118b7ad86097c9425e63313b0a3d80))

## [0.82.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.81.0...v0.82.0) (2026-10-27)

### Features

- **billing:** assemble bound renewal configuration candidates ([46919da](https://github.com/FantasticDevHQ/better-stripe/commit/46919da1abccec07b28b972165a1e2e166d3aa5c))

## [0.81.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.80.0...v0.81.0) (2026-10-27)

### Features

- **billing:** project preserved renewal billing settings ([349d56e](https://github.com/FantasticDevHQ/better-stripe/commit/349d56e3c001da239958762f6dbcb06d613ccade))

## [0.80.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.79.1...v0.80.0) (2026-10-27)

### Features

- **billing:** prepare bound renewal replacement snapshots ([#394](https://github.com/FantasticDevHQ/better-stripe/issues/394)) ([42514b7](https://github.com/FantasticDevHQ/better-stripe/commit/42514b7c045bc845e4e96549eb5d0af75a762b0b))

## [0.79.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.79.0...v0.79.1) (2026-10-26)

### Maintenance

- **coverage:** ratchet earned coverage floors ([#392](https://github.com/FantasticDevHQ/better-stripe/issues/392)) ([3b61191](https://github.com/FantasticDevHQ/better-stripe/commit/3b611911e1e1dbcb7e78d03509121731b2c57f92))

## [0.79.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.78.0...v0.79.0) (2026-10-25)

### Features

- **portal:** add caller-owned retry-safe request identity ([#390](https://github.com/FantasticDevHQ/better-stripe/issues/390)) ([25803be](https://github.com/FantasticDevHQ/better-stripe/commit/25803be1ebc15d8ba6af41610d97fca4f340eeba))

## [0.78.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.77.0...v0.78.0) (2026-10-25)

### Features

- **portal:** add targeted subscription confirmation ([#388](https://github.com/FantasticDevHQ/better-stripe/issues/388)) ([7421370](https://github.com/FantasticDevHQ/better-stripe/commit/74213702b177dfa73604e167ca213ce2627e3a85))

## [0.77.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.76.0...v0.77.0) (2026-10-24)

### Features

- **example:** authorize captured Checkout receipts ([#386](https://github.com/FantasticDevHQ/better-stripe/issues/386)) ([2589dcc](https://github.com/FantasticDevHQ/better-stripe/commit/2589dcceff5408bd8dd426fd4395a5bb9ab9fd3a))

## [0.76.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.75.0...v0.76.0) (2026-10-24)

### Features

- **checkout:** expose fee-independent captured payment observations ([#384](https://github.com/FantasticDevHQ/better-stripe/issues/384)) ([bae2e74](https://github.com/FantasticDevHQ/better-stripe/commit/bae2e7412f3ec8f2a70ba0ceb1cb26b952bae7e1))

## [0.75.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.74.0...v0.75.0) (2026-10-23)

### Features

- preview account closure blockers and guard confirmed scope ([#382](https://github.com/FantasticDevHQ/better-stripe/issues/382)) ([4289300](https://github.com/FantasticDevHQ/better-stripe/commit/428930012022a51734570e8849eff0bb53aa8d6a))

## [0.74.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.73.0...v0.74.0) (2026-10-21)

### Features

- **products:** allow updates to disable descriptor inheritance ([#380](https://github.com/FantasticDevHQ/better-stripe/issues/380)) ([d98c880](https://github.com/FantasticDevHQ/better-stripe/commit/d98c880160eeb7c772fe0a4a12b976bee57aaabc))

## [0.73.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.72.3...v0.73.0) (2026-10-20)

### Features

- **products:** support explicit platform product descriptors ([#378](https://github.com/FantasticDevHQ/better-stripe/issues/378)) ([8cda57a](https://github.com/FantasticDevHQ/better-stripe/commit/8cda57a2bbcc16a898d2dd69601a6d4641fc1c18))

## [0.72.3](https://github.com/FantasticDevHQ/better-stripe/compare/v0.72.2...v0.72.3) (2026-10-20)

### Bug Fixes

- preserve caller keys for product SETs ([#376](https://github.com/FantasticDevHQ/better-stripe/issues/376)) ([9101beb](https://github.com/FantasticDevHQ/better-stripe/commit/9101beb09c4f2c1f43f536cd83c881784da61b29))

## [0.72.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.72.1...v0.72.2) (2026-10-20)

### Tests

- verify Maya membership across both integration views ([#374](https://github.com/FantasticDevHQ/better-stripe/issues/374)) ([4faf5c7](https://github.com/FantasticDevHQ/better-stripe/commit/4faf5c76e6b274ac118004d42bbf0febe14dcbff))

## [0.72.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.72.0...v0.72.1) (2026-10-20)

### Bug Fixes

- accept legacy customer projections in V2 Checkout pages ([40d5f7e](https://github.com/FantasticDevHQ/better-stripe/commit/40d5f7ea57edaebb19aa89d396c6a802873609b2))

## [0.72.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.71.0...v0.72.0) (2026-10-20)

### Features

- settle mixed monthly-fee and metered invoices ([#370](https://github.com/FantasticDevHQ/better-stripe/issues/370)) ([bf99016](https://github.com/FantasticDevHQ/better-stripe/commit/bf99016aa75df9f27c553d2524aca9161a5f8184))

## [0.71.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.70.0...v0.71.0) (2026-10-19)

### Features

- **catalog:** paginate prices by provider product ([033620b](https://github.com/FantasticDevHQ/better-stripe/commit/033620ba33516ca3c99e8d5a8c9de95615434ca9))
- **catalog:** paginate prices by provider product ([5622b05](https://github.com/FantasticDevHQ/better-stripe/commit/5622b0583b9d8e378b708a01913306561aba23e0))

## [0.70.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.69.0...v0.70.0) (2026-10-19)

### Features

- **react:** allow product editing without creation callbacks ([#366](https://github.com/FantasticDevHQ/better-stripe/issues/366)) ([28a4c54](https://github.com/FantasticDevHQ/better-stripe/commit/28a4c54e907b6c41f8d0b34b7921b97319118f19))

## [0.69.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.68.1...v0.69.0) (2026-10-19)

### Features

- **example:** product metered billing with headless and component views ([#364](https://github.com/FantasticDevHQ/better-stripe/issues/364)) ([cd978c2](https://github.com/FantasticDevHQ/better-stripe/commit/cd978c22e7a87f36e5bb0c066011b3cd82f2d0cb))

## [0.68.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.68.0...v0.68.1) (2026-10-19)

### Documentation

- align public guides and simplify package maintenance ([#361](https://github.com/FantasticDevHQ/better-stripe/issues/361)) ([f0a07f9](https://github.com/FantasticDevHQ/better-stripe/commit/f0a07f92e1de8b044c1780a9a7551b531b9ff9e3))

### Maintenance

- **coverage:** ratchet earned coverage floors ([#362](https://github.com/FantasticDevHQ/better-stripe/issues/362)) ([df7db01](https://github.com/FantasticDevHQ/better-stripe/commit/df7db0112a551702540733b65f9541fcfc280ee9))

## [0.68.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.67.1...v0.68.0) (2026-10-19)

### Features

- **catalog:** add bounded product and price identity readers ([47ed528](https://github.com/FantasticDevHQ/better-stripe/commit/47ed528c8d1116b1e56f2e5d1dad7830c2a0f0f4))
- **catalog:** add bounded product and price identity readers ([01ed5f9](https://github.com/FantasticDevHQ/better-stripe/commit/01ed5f9ba1d1c7c72fe597805bb9094f546e19a9))

## [0.67.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.67.0...v0.67.1) (2026-10-19)

### Documentation

- **usage:** finalize native billing setup and release handoff ([#356](https://github.com/FantasticDevHQ/better-stripe/issues/356)) ([de9bfb1](https://github.com/FantasticDevHQ/better-stripe/commit/de9bfb1b2bb6d17f2b415204dd0601528241b244))

## [0.67.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.66.0...v0.67.0) (2026-10-19)

### Features

- **settlement:** retain immutable host policy context ([9c31855](https://github.com/FantasticDevHQ/better-stripe/commit/9c31855a8b50f94f64b5d2911e6a124bebc335f0))
- **settlement:** retain immutable host policy context ([54380ad](https://github.com/FantasticDevHQ/better-stripe/commit/54380addd2af4c7648ca7745d58241593332a35c))

### Bug Fixes

- enable strict component project typechecking ([ed02ac7](https://github.com/FantasticDevHQ/better-stripe/commit/ed02ac79ceb1e9cffe62d4e9b021153b77109281))

### Tests

- **settlement:** replay saved policy context in affiliate offset fixture ([81906d7](https://github.com/FantasticDevHQ/better-stripe/commit/81906d71b72fa99da421d8a8f77b0023a180d3e1))
- **settlement:** split recovery fixture and retain native policy context bindings ([a245889](https://github.com/FantasticDevHQ/better-stripe/commit/a2458891098f8c8f95faa77e18b61b117e1ee392))

## [0.66.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.65.0...v0.66.0) (2026-10-18)

### Features

- **react:** expose custom checkout promotion actions and pricing ([0858687](https://github.com/FantasticDevHQ/better-stripe/commit/08586871ddaf0fe9f5341e7169b837a712babbc5))

## [0.65.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.64.1...v0.65.0) (2026-10-18)

### Features

- **settlement:** reauthorize new transfer dispatch ([d9588ee](https://github.com/FantasticDevHQ/better-stripe/commit/d9588ee80260371a172305bae1efd5278516d44f))

### Bug Fixes

- **example:** authorize frozen settlement leg amounts ([4bd94c4](https://github.com/FantasticDevHQ/better-stripe/commit/4bd94c4a75f58586868889a67e57e51f96cec538))

## [0.64.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.64.0...v0.64.1) (2026-10-18)

### Tests

- **usage:** verify native three-model economics and packed consumers ([#349](https://github.com/FantasticDevHQ/better-stripe/issues/349)) ([d6f801a](https://github.com/FantasticDevHQ/better-stripe/commit/d6f801ab209f55535fdea075fa5c0072f7da66cd))

## [0.64.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.63.0...v0.64.0) (2026-10-18)

### Features

- journal payout revisions and retain reversal claim history ([#316](https://github.com/FantasticDevHQ/better-stripe/issues/316)) ([0cbad43](https://github.com/FantasticDevHQ/better-stripe/commit/0cbad4369627b2f0669ff918dcf68e9b47633cae))

### Bug Fixes

- **example:** refresh original financial evidence before usage cleanup ([#347](https://github.com/FantasticDevHQ/better-stripe/issues/347)) ([d70a1c2](https://github.com/FantasticDevHQ/better-stripe/commit/d70a1c2a83c601d75f5f9949cc900835beacbe7c))
- reuse package currency formatting and document example boundaries ([#310](https://github.com/FantasticDevHQ/better-stripe/issues/310)) ([5469f31](https://github.com/FantasticDevHQ/better-stripe/commit/5469f31d9a9ad03151541a79a2e0677f0fcf93f3))

## [0.63.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.62.0...v0.63.0) (2026-10-18)

### Features

- **example:** demonstrate all three native billing models ([#345](https://github.com/FantasticDevHQ/better-stripe/issues/345)) ([bc828b0](https://github.com/FantasticDevHQ/better-stripe/commit/bc828b060b30e1ae4dcf5edc0a0d01fdc06522a0))

## [0.62.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.61.0...v0.62.0) (2026-10-18)

### Features

- **react:** configure all three native usage billing models ([#343](https://github.com/FantasticDevHQ/better-stripe/issues/343)) ([a6733d6](https://github.com/FantasticDevHQ/better-stripe/commit/a6733d6af8ef12ac6bdd6a736bf9319b1659b2fb))

## [0.61.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.60.1...v0.61.0) (2026-10-18)

### Features

- **react:** reusable metered billing views for all three models ([#341](https://github.com/FantasticDevHQ/better-stripe/issues/341)) ([0eee6cc](https://github.com/FantasticDevHQ/better-stripe/commit/0eee6cc1a6d3ebd821b855a04f98cc017c6198f6))

## [0.60.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.60.0...v0.60.1) (2026-10-18)

### Bug Fixes

- **usage:** enforce original customer and recovery boundaries ([#339](https://github.com/FantasticDevHQ/better-stripe/issues/339)) ([35c0af1](https://github.com/FantasticDevHQ/better-stripe/commit/35c0af1293a78420485bcbb25470c6159ea48d89))

## [0.60.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.59.0...v0.60.0) (2026-10-18)

### Features

- **usage:** settle verified native invoice and issuer credit proceeds ([#337](https://github.com/FantasticDevHQ/better-stripe/issues/337)) ([3c2844a](https://github.com/FantasticDevHQ/better-stripe/commit/3c2844a6a6a51d2a4f884e25a333165314bcc141))

## [0.59.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.58.0...v0.59.0) (2026-10-18)

### Features

- add auditable usage corrections and invoice adjustment evidence ([#335](https://github.com/FantasticDevHQ/better-stripe/issues/335)) ([6b0ec3a](https://github.com/FantasticDevHQ/better-stripe/commit/6b0ec3adbe87169887afef7ba523644ff1b8c1a2))

## [0.58.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.57.0...v0.58.0) (2026-10-18)

### Features

- add atomic included usage and optional limits ([#333](https://github.com/FantasticDevHQ/better-stripe/issues/333)) ([3980483](https://github.com/FantasticDevHQ/better-stripe/commit/398048346056f5ca85fd0bfafa2fa4cceab40443))

## [0.57.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.56.0...v0.57.0) (2026-10-18)

### Features

- add payment-backed prepaid usage accounting ([#331](https://github.com/FantasticDevHQ/better-stripe/issues/331)) ([b38d99c](https://github.com/FantasticDevHQ/better-stripe/commit/b38d99c3c8be133183cf9d8d776dc5149709e7e7))

### Bug Fixes

- close qualified SetupIntent status contract ([#313](https://github.com/FantasticDevHQ/better-stripe/issues/313)) ([7766f7c](https://github.com/FantasticDevHQ/better-stripe/commit/7766f7cd5fc96596f118e63bf3346d578cc8316a))
- preserve previous subscription identity for delete triggers ([#317](https://github.com/FantasticDevHQ/better-stripe/issues/317)) ([ccc7b07](https://github.com/FantasticDevHQ/better-stripe/commit/ccc7b0793dd8d9892a35c5373b5ea47a88a7b305))
- **usage:** compose prepared authorization with ledger recording ([#326](https://github.com/FantasticDevHQ/better-stripe/issues/326)) ([8f1b298](https://github.com/FantasticDevHQ/better-stripe/commit/8f1b298e4a9587f6a82d73ffe28e332144988a7f))

## [0.56.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.55.0...v0.56.0) (2026-10-18)

### Features

- manage metered subscriptions and invoice lifecycle ([#329](https://github.com/FantasticDevHQ/better-stripe/issues/329)) ([460e473](https://github.com/FantasticDevHQ/better-stripe/commit/460e473fec47da38acde0f1f61c843fe47336071))

## [0.55.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.54.0...v0.55.0) (2026-10-18)

### Features

- add scoped usage observations, audit history and reconciliation ([#327](https://github.com/FantasticDevHQ/better-stripe/issues/327)) ([b604728](https://github.com/FantasticDevHQ/better-stripe/commit/b6047284b60523827961182045e2643aa7f8ac32))

## [0.54.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.53.0...v0.54.0) (2026-10-18)

### Features

- deliver native Stripe usage with durable scoped workflows ([#324](https://github.com/FantasticDevHQ/better-stripe/issues/324)) ([ca739b4](https://github.com/FantasticDevHQ/better-stripe/commit/ca739b4fd5ed6ad69319d631aaa02b392f941d60))

## [0.53.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.52.0...v0.53.0) (2026-10-18)

### Features

- add native Stripe usage catalog and lifecycle APIs ([#322](https://github.com/FantasticDevHQ/better-stripe/issues/322)) ([19e052d](https://github.com/FantasticDevHQ/better-stripe/commit/19e052d55bc54ba542aca6c0de4e47eb702518c0))

## [0.52.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.51.0...v0.52.0) (2026-10-18)

### Features

- add atomic scoped usage ledger and durable outbox ([c4a4f39](https://github.com/FantasticDevHQ/better-stripe/commit/c4a4f39749ec6399514176e1deb02a379278349a))

### Bug Fixes

- reject unavailable usage reservation references ([d6b7f16](https://github.com/FantasticDevHQ/better-stripe/commit/d6b7f1666a2acf35aae45e590ffc1f5eb3fca8a5))

### Tests

- retain improved atomic ledger coverage floors ([4b88773](https://github.com/FantasticDevHQ/better-stripe/commit/4b88773e3ff5489c4f473f4e4f5a6ecaf2a7cfbf))

## [0.51.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.50.3...v0.51.0) (2026-10-18)

### Features

- complete scoped usage API and host authorization contracts ([41d58ac](https://github.com/FantasticDevHQ/better-stripe/commit/41d58ac99ff63c89c17143dde5e59de04ee2c80d))

### Documentation

- align metering status and index with native sandbox evidence ([d1c1bf5](https://github.com/FantasticDevHQ/better-stripe/commit/d1c1bf57893c6045c91a8c9103ea02103c871ed9))

### Continuous Integration

- batch coverage floor increases in weekly PRs ([d648b82](https://github.com/FantasticDevHQ/better-stripe/commit/d648b82f6c910b16c6349096a2022c798777f608))
- batch coverage floor increases in weekly PRs ([8217f1f](https://github.com/FantasticDevHQ/better-stripe/commit/8217f1fe9e1bdac5c730d98cc1022ea7cd1c385c))

### Tests

- ratchet native usage contract coverage floors ([5c8ff1b](https://github.com/FantasticDevHQ/better-stripe/commit/5c8ff1b31913a08db9493cc5a0219601ad540608))

## [0.50.3](https://github.com/FantasticDevHQ/better-stripe/compare/v0.50.2...v0.50.3) (2026-10-18)

### Documentation

- move detailed reference guides out of README ([4aa27e0](https://github.com/FantasticDevHQ/better-stripe/commit/4aa27e0fbbc275ccbeed64ba6cba51e1c1e73a9e))
- shorten README and stabilize documentation verification ([de46f55](https://github.com/FantasticDevHQ/better-stripe/commit/de46f55feed4286963e221096ed47eb07d4e6940))

## [0.50.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.50.1...v0.50.2) (2026-10-18)

### Documentation

- start metered billing provider feasibility ([844fb74](https://github.com/FantasticDevHQ/better-stripe/commit/844fb74c30081baac16a8275a1ae73a98a5b3753))

## [0.50.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.50.0...v0.50.1) (2026-10-17)

### Bug Fixes

- **react:** initialize workflow refs before descendant layout effects ([b6a9da8](https://github.com/FantasticDevHQ/better-stripe/commit/b6a9da8ad0cd3043a575420bd876b1878d9ed9f4))
- **react:** settle commit-started workflow actions ([f1befb4](https://github.com/FantasticDevHQ/better-stripe/commit/f1befb4194dee87b0b1c54528ae4305b5b749147))
- **react:** settle workflow actions started during commit ([5d4d2e1](https://github.com/FantasticDevHQ/better-stripe/commit/5d4d2e1fa3623205b3f971f1e5e1c9d24919a091))

## [0.50.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.49.0...v0.50.0) (2026-10-17)

### Features

- read an original qualified SetupIntent ([82301a5](https://github.com/FantasticDevHQ/better-stripe/commit/82301a594c07ae6f290eeba046f47fdbbadd142d))
- read an original qualified SetupIntent ([209d96b](https://github.com/FantasticDevHQ/better-stripe/commit/209d96b6cbb2970a4c990ac226a0c3293e92c830))

### Bug Fixes

- preserve opaque original setup user identity ([e539a4c](https://github.com/FantasticDevHQ/better-stripe/commit/e539a4c0fa66a8f414655ea520da154a1e9de267))

### Maintenance

- ratchet measured SetupIntent reader coverage ([4794705](https://github.com/FantasticDevHQ/better-stripe/commit/4794705793190b4cc45346eabed645238944499f))

## [0.49.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.48.1...v0.49.0) (2026-10-17)

### Features

- add exact invoice-payment read with original scope verification ([c87abb3](https://github.com/FantasticDevHQ/better-stripe/commit/c87abb3d243f3c18fc2ccf37ef05c22c1eb463c3))
- read exact invoice payments with verified original scope ([f96853e](https://github.com/FantasticDevHQ/better-stripe/commit/f96853e1656fbc1ded60a87e58920598b90fd62a))
- scope card selection to an original subscription ([b1165e2](https://github.com/FantasticDevHQ/better-stripe/commit/b1165e20b058aa064c41b047b4226f709eab7cc6))

### Bug Fixes

- add opt-in exact PaymentIntent uniqueness ([f440725](https://github.com/FantasticDevHQ/better-stripe/commit/f4407258df63aeb448bb213ce870c70e000be56d))
- add opt-in unique cached PaymentIntent reads ([0148352](https://github.com/FantasticDevHQ/better-stripe/commit/0148352f011917e45500f8521ae30d0e0682d491))
- snapshot original subscription card selectors before reads ([eb92b1c](https://github.com/FantasticDevHQ/better-stripe/commit/eb92b1cc84943aef7ea38808cbeb120b7ed0de8e))

### Maintenance

- ratchet measured exact invoice-payment coverage floors ([3fc1443](https://github.com/FantasticDevHQ/better-stripe/commit/3fc1443fd4da8dea011ebf2821f754dad0c4a207))
- record native-generated strict payment reference ([17198e8](https://github.com/FantasticDevHQ/better-stripe/commit/17198e81733641507c872602d0170c216b42a58f))

## [0.48.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.48.0...v0.48.1) (2026-10-17)

### Bug Fixes

- add opt-in unique original Stripe ID reads ([1adf7a8](https://github.com/FantasticDevHQ/better-stripe/commit/1adf7a80ce2445daf4435ab975035e50d647d86e))
- add opt-in unique original Stripe ID reads ([8cbc6b3](https://github.com/FantasticDevHQ/better-stripe/commit/8cbc6b3e779f622f9e94a607d230d7f9a2c4122a))

### Maintenance

- generate unique original ID reader bindings ([a01579f](https://github.com/FantasticDevHQ/better-stripe/commit/a01579f46c1f2145868d57cd9d485fd194651484))

### Tests

- cover unique original ID reads and trusted host use ([bef2882](https://github.com/FantasticDevHQ/better-stripe/commit/bef2882516542d336b7b06c4e6843aa1b7d528d0))
- ratchet measured original ID reader coverage ([c6a6a10](https://github.com/FantasticDevHQ/better-stripe/commit/c6a6a106281d4320bbf8581294c386650e051bba))

## [0.48.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.47.1...v0.48.0) (2026-10-17)

### Features

- **billing:** add scoped history pagination ([94d7fb8](https://github.com/FantasticDevHQ/better-stripe/commit/94d7fb8118c57260caeea2fc962248c82bdb1d95))
- expose bounded cached billing history pages ([4c88eb4](https://github.com/FantasticDevHQ/better-stripe/commit/4c88eb41d514341f9dfafc7822ebba71961d423c))
- publish generated billing history page contracts ([f834bbe](https://github.com/FantasticDevHQ/better-stripe/commit/f834bbedf029046b9148bea5b0ccaf549a08a308))

### Bug Fixes

- **billing:** derive history pages from authoritative component documents ([a6fe0a0](https://github.com/FantasticDevHQ/better-stripe/commit/a6fe0a00894f6614b9e4555d342c940bf553b421))
- reconcile signed refund delivery against current provider state ([b228446](https://github.com/FantasticDevHQ/better-stripe/commit/b228446373854ac17e62b6ee091c67959b8f22a3))

### Tests

- **billing:** cover scoped history budgets and authorized projections ([b3c6384](https://github.com/FantasticDevHQ/better-stripe/commit/b3c638439c763e8ee8bdbd49b7f89f50d2de23db))
- **billing:** preserve generic dispatcher mock compatibility ([c04fcb6](https://github.com/FantasticDevHQ/better-stripe/commit/c04fcb642232f081ac886ea089b1cc720548eb1e))
- extract refund fixtures within existing file budgets ([705a1dd](https://github.com/FantasticDevHQ/better-stripe/commit/705a1dda944aa5c1a762824f487970a538aac16c))
- preserve split recovery assertions through current refund qualification ([3697739](https://github.com/FantasticDevHQ/better-stripe/commit/3697739f6a29e34b4cd450eb5e7125e4096a6a05))
- ratchet measured billing history coverage floors ([39d591e](https://github.com/FantasticDevHQ/better-stripe/commit/39d591e25b0e366404484317dd514be3bb98e610))

## [0.47.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.47.0...v0.47.1) (2026-10-17)

### Bug Fixes

- load compiled public SDK with standard Node ESM ([5b47932](https://github.com/FantasticDevHQ/better-stripe/commit/5b4793231035c60c9958500819494d215dc22907))
- preserve plain Node ESM public exports ([bb63e21](https://github.com/FantasticDevHQ/better-stripe/commit/bb63e2186f9cab6f8a6408518ee3033d96875b9e))
- **react:** allow valid zero plan prices ([007825a](https://github.com/FantasticDevHQ/better-stripe/commit/007825a96d4767df5a586428ebcbcc863bdd473c))
- **react:** allow valid zero plan prices ([6bb7571](https://github.com/FantasticDevHQ/better-stripe/commit/6bb75719891450bbc848a05045b5528e38627fc1))

## [0.47.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.46.0...v0.47.0) (2026-10-17)

### Features

- commit qualified refund callbacks with accepted generations ([2b429aa](https://github.com/FantasticDevHQ/better-stripe/commit/2b429aa6a3f91ba39e23e34b0823489719473ce6))

### Bug Fixes

- commit qualified refund callbacks atomically ([076c353](https://github.com/FantasticDevHQ/better-stripe/commit/076c353aef3ad4beaa71ad410551c6076abb861d))
- validate opaque component IDs in host refund receipts ([56d97ad](https://github.com/FantasticDevHQ/better-stripe/commit/56d97ad9e619299ee37437d7330ffb840a04b730))

### Maintenance

- integrate accepted upstream release metadata ([14d6641](https://github.com/FantasticDevHQ/better-stripe/commit/14d6641c2403c00fe5d5bd014ef3e8206d18b68b))
- ratchet qualified refund callback coverage floors ([ba11593](https://github.com/FantasticDevHQ/better-stripe/commit/ba1159358b29f5572587113742d67e6ea919a34f))

## [0.46.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.45.2...v0.46.0) (2026-10-17)

### Features

- qualify current refund observations by generation ([d9832dd](https://github.com/FantasticDevHQ/better-stripe/commit/d9832ddf101cbd19817c7e68bfabc04ff96baecd))

### Bug Fixes

- reconcile current refund observations by generation ([67d6dfc](https://github.com/FantasticDevHQ/better-stripe/commit/67d6dfc4a25521174e64a1df7491dc64670d1e34))

### Maintenance

- ratchet measured refund sync coverage floors ([8a8f702](https://github.com/FantasticDevHQ/better-stripe/commit/8a8f702649f19cb86ad3c73c0831c30c22371ee4))
- regenerate current refund sync references ([bc66934](https://github.com/FantasticDevHQ/better-stripe/commit/bc66934dbcb1f5da3670fb118a33a6389aadc47f))

### Tests

- preserve atomic refund acceptance and routing checks ([2b8deb5](https://github.com/FantasticDevHQ/better-stripe/commit/2b8deb5336ad48997f68748a402bae101ea07bb2))
- verify current refund scope and observation recovery ([aeec291](https://github.com/FantasticDevHQ/better-stripe/commit/aeec291a9c8b5bd57629ff668d5bb5343aa0d32e))

## [0.45.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.45.1...v0.45.2) (2026-10-17)

### Bug Fixes

- ship complete migration guides and release handoff ([a619b66](https://github.com/FantasticDevHQ/better-stripe/commit/a619b66335d1898fadf6790bc8b878ad7324ce57))
- ship workflow migration guides and release handoff ([08c870c](https://github.com/FantasticDevHQ/better-stripe/commit/08c870cdcc8cb5e841b0ca522cd58ce8867a7270))

## [0.45.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.45.0...v0.45.1) (2026-10-17)

### Tests

- verify cross-domain durable execution invariants ([392080f](https://github.com/FantasticDevHQ/better-stripe/commit/392080f5d166ad731864ac0db4897fe6a1b7de63))
- verify cross-domain durable execution invariants ([c814519](https://github.com/FantasticDevHQ/better-stripe/commit/c8145194ac0b9fb51b92109ffd2d6be5cf44488f))

## [0.45.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.44.0...v0.45.0) (2026-10-17)

### Features

- migrate example recovery to component workflows ([13ca8ea](https://github.com/FantasticDevHQ/better-stripe/commit/13ca8ea48a9f014838dad56f5bcf04300f4bba5e))
- migrate example recovery to component workflows ([a60dd5a](https://github.com/FantasticDevHQ/better-stripe/commit/a60dd5a18869feb5dd9906333cabe8dcf11be53d))

### Bug Fixes

- preserve affiliate offsets and fence direct recovery payouts ([782264c](https://github.com/FantasticDevHQ/better-stripe/commit/782264c1d55c4177607ebd76f4fa83266900956f))

### Documentation

- fix balance-funding preview configuration ([bc427aa](https://github.com/FantasticDevHQ/better-stripe/commit/bc427aa8d89b700481725efd391eab187c5118dc))

### Tests

- ratchet recovery migration coverage floors ([4e79b74](https://github.com/FantasticDevHQ/better-stripe/commit/4e79b74468bab0dfc3020f6ce99a03edb738018b))
- run commission regressions through nested recovery workflows ([7343bd2](https://github.com/FantasticDevHQ/better-stripe/commit/7343bd2f7dec240f5c7c3b85b1722e2d80e72b36))
- verify bounded invoice proof and isolate provider fixtures ([39c3ae3](https://github.com/FantasticDevHQ/better-stripe/commit/39c3ae33ba8189d54e1a926deca0cb4ec74c11ae))

## [0.44.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.43.0...v0.44.0) (2026-10-17)

### Features

- migrate example balance funding to component workflows ([68f6cb4](https://github.com/FantasticDevHQ/better-stripe/commit/68f6cb471c07b79ca8f0dba6d2d160fd250baf32))
- move example balance funding into component workflows ([93ac5ce](https://github.com/FantasticDevHQ/better-stripe/commit/93ac5ce036120e42c0dd3b1cb23295965b7da98d))

### Bug Fixes

- fence legacy workers and recover abandoned funding observers ([eaa8c2c](https://github.com/FantasticDevHQ/better-stripe/commit/eaa8c2c214d73f5ee49d76df8b005a2293d02f85))

### Tests

- ratchet balance funding adapter coverage floors ([5cce0eb](https://github.com/FantasticDevHQ/better-stripe/commit/5cce0ebd5114f39c4a17a5f1284d42876304f510))
- ratchet funding migration recovery coverage floors ([1a1bec5](https://github.com/FantasticDevHQ/better-stripe/commit/1a1bec5215786812734cfe4be0e8027f793c5cb3))

## [0.43.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.42.0...v0.43.0) (2026-10-17)

### Features

- add guarded processing-cost reconciliation workflow ([79f2741](https://github.com/FantasticDevHQ/better-stripe/commit/79f27416e8cdf13d18c4afe4a90a07f9ba7b4ced))
- reconcile processing-cost claims with guarded workflow ([96f1fd1](https://github.com/FantasticDevHQ/better-stripe/commit/96f1fd1e93bba08a5182acb1c453e5ea5621fcbd))

### Bug Fixes

- bind bounded processing transactions to original cost sources ([4165f5a](https://github.com/FantasticDevHQ/better-stripe/commit/4165f5af3af550d43c5575652c2a2b162da74748))

### Tests

- ratchet processing-cost reconciliation coverage floors ([d462d9a](https://github.com/FantasticDevHQ/better-stripe/commit/d462d9ad9ee623de2f3460a0979435448ebbab85))

## [0.42.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.41.0...v0.42.0) (2026-10-17)

### Features

- add durable balance funding workflows ([59c46e7](https://github.com/FantasticDevHQ/better-stripe/commit/59c46e7c0a41aee3df0b743099bf57d67921046b))

### Tests

- ratchet integrated funding and recovery coverage ([deb5249](https://github.com/FantasticDevHQ/better-stripe/commit/deb524903b9c51ba2173df4063add29e85f4fdf7))

## [0.41.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.40.0...v0.41.0) (2026-10-17)

### Features

- orchestrate durable recovery groups ([a140f64](https://github.com/FantasticDevHQ/better-stripe/commit/a140f642977f6816ca39cc817359c2638064ca5d))

### Maintenance

- ratchet recovery workflow coverage floors ([30a567b](https://github.com/FantasticDevHQ/better-stripe/commit/30a567b4b3053dd3a622e9ce08a77c79ed3863ed))

## [0.40.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.39.0...v0.40.0) (2026-10-17)

### Features

- verify original payment sources and invoice prices ([a9b4baf](https://github.com/FantasticDevHQ/better-stripe/commit/a9b4baf6fdaa19315411ee9ad15e44cb2ee0a344))

### Maintenance

- ratchet coverage after payment source verification ([50c5b2b](https://github.com/FantasticDevHQ/better-stripe/commit/50c5b2b00d529356a0f7c68524029426b7948846))

### Refactoring

- **example:** adopt component catalog, portal and account APIs ([3168bb2](https://github.com/FantasticDevHQ/better-stripe/commit/3168bb2c197f342cf79b6611d1e74bc5cff74637))

## [0.39.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.38.0...v0.39.0) (2026-10-17)

### Features

- add nested durable execution runtime ([4e300df](https://github.com/FantasticDevHQ/better-stripe/commit/4e300dfcd12dac3be6a9ee568502766d94b7ac11))
- add policy-explicit processing cost deficit calculator ([eaab6dc](https://github.com/FantasticDevHQ/better-stripe/commit/eaab6dcaa06554ae7ba3ba7035194758ae0a0926))
- add policy-explicit processing cost deficit calculator ([ac18f4e](https://github.com/FantasticDevHQ/better-stripe/commit/ac18f4eaab624730cc45b3a31039809c8a8e8f8a))
- **cost-recovery:** prepare bounded groups atomically ([cad0ec7](https://github.com/FantasticDevHQ/better-stripe/commit/cad0ec729a9b72ad17b09311808e524fd73fa667))
- **cost-recovery:** prepare bounded recovery groups atomically ([2157234](https://github.com/FantasticDevHQ/better-stripe/commit/215723444c649c341861ec58a030df3331c151b6))
- persist durable balance funding operations ([11b81d5](https://github.com/FantasticDevHQ/better-stripe/commit/11b81d5a66548f73d131555dd3034eb79629c39e))
- persist versioned balance funding preparations and operations ([d8943eb](https://github.com/FantasticDevHQ/better-stripe/commit/d8943ebb251df672b435fe7722877bbd3395c498))
- recover funding preparation by immutable scoped request ([a2c839c](https://github.com/FantasticDevHQ/better-stripe/commit/a2c839c29faddcc04ac52aeac26dfcfa5c5352da))

### Maintenance

- ratchet coverage after durable funding state checks ([a2be05d](https://github.com/FantasticDevHQ/better-stripe/commit/a2be05dd60e12abfdff7d4bafad848f408074b75))
- ratchet funding coverage after calculator integration ([b709c7d](https://github.com/FantasticDevHQ/better-stripe/commit/b709c7d251ff59ca297f7bfbb3dba0599c8cee7f))
- ratchet funding coverage after catalog integration ([71ac9b6](https://github.com/FantasticDevHQ/better-stripe/commit/71ac9b60ba6fb76fac0055811fe5ce185a92b145))
- ratchet funding coverage after outcomes integration ([8e8282c](https://github.com/FantasticDevHQ/better-stripe/commit/8e8282ce9d4584943cb69c71e481e0337a6a7bd7))

## [0.38.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.37.1...v0.38.0) (2026-10-17)

### Features

- **accounts:** add merchant configuration and transfer readiness ([e9994a9](https://github.com/FantasticDevHQ/better-stripe/commit/e9994a9e49295ebd963cf30ecd3fb6d62d38a409))
- add typed financial readiness and bounded retry policy ([9dae843](https://github.com/FantasticDevHQ/better-stripe/commit/9dae843d17d1a83fed9f496bb28f10e902b69170))
- **billing:** add typed portal configuration APIs ([f43f5f6](https://github.com/FantasticDevHQ/better-stripe/commit/f43f5f670a894d48f9bc29ba18f82c0b4ad5e369))
- **billing:** add typed portal configuration APIs ([8ff5510](https://github.com/FantasticDevHQ/better-stripe/commit/8ff5510ba6e9135bf7a4d48610a3cc85dbe8aff4))
- **catalog:** ensure lookup-key prices and adopt products ([e3f75fc](https://github.com/FantasticDevHQ/better-stripe/commit/e3f75fce959256dafa3475f67e9a2b65c4faeb71))
- **catalog:** ensure lookup-key prices and adopt products ([9dcc092](https://github.com/FantasticDevHQ/better-stripe/commit/9dcc0927543f87bb932e24e38811b413a07c97e4))
- standardize financial readiness and bounded retries ([06ae478](https://github.com/FantasticDevHQ/better-stripe/commit/06ae478ff2ee5c9e89f79d109ae1e92a3f8510b7))

### Bug Fixes

- **catalog:** enforce adoption ownership atomically ([afd9909](https://github.com/FantasticDevHQ/better-stripe/commit/afd9909f93973af329abe46858f646d03d1d24d2))

### Documentation

- complete durable preparation handoff contracts ([066dda2](https://github.com/FantasticDevHQ/better-stripe/commit/066dda2626f6f713af95bb5cb34bc09ddca2e8b9))
- define component extraction and durable execution contracts ([c27a215](https://github.com/FantasticDevHQ/better-stripe/commit/c27a21577e9f52ab62f3c45f14f484e584e9d0db))
- define scoped preparation results and migration pauses ([1d0a07f](https://github.com/FantasticDevHQ/better-stripe/commit/1d0a07f8b634182dc04ade4c36cca7311e2c3773))
- refresh extraction contract review baseline ([070ba5f](https://github.com/FantasticDevHQ/better-stripe/commit/070ba5f6ec833ee780414d2fae0ca6498699121e))

### Maintenance

- ratchet portal coverage after earnings integration ([a179036](https://github.com/FantasticDevHQ/better-stripe/commit/a17903630339e00041c0e86c5da3e223a6a0b084))
- ratchet portal coverage after merged contracts integration ([5faff9a](https://github.com/FantasticDevHQ/better-stripe/commit/5faff9aa5206bbcadf8086a966162631c5b7ac42))
- ratchet portal coverage after seller attribution integration ([fdcb303](https://github.com/FantasticDevHQ/better-stripe/commit/fdcb3033df39b43d2d33bb8e41ef7397ad36509d))

### Refactoring

- reuse package currency and embedded session APIs ([#247](https://github.com/FantasticDevHQ/better-stripe/issues/247)) ([c4ab43c](https://github.com/FantasticDevHQ/better-stripe/commit/c4ab43cc9bccf631fd5a576131ddc65f489fead5))

## [0.37.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.37.0...v0.37.1) (2026-10-17)

### Bug Fixes

- **release:** preserve parseable descriptions and correct release notes ([e3f93d9](https://github.com/FantasticDevHQ/better-stripe/commit/e3f93d9276d5f51468d11fdfa932605db2e748e4))
- **release:** preserve parseable reviewed release descriptions ([7aaf445](https://github.com/FantasticDevHQ/better-stripe/commit/7aaf445af08ed59d04c0d5e7958dfd82f5282974))
- **release:** reject nested version selectors in notes ([067b45e](https://github.com/FantasticDevHQ/better-stripe/commit/067b45e575e2b4cadd3e07a2db1a1c9dee73960f))

## [0.37.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.35.0...v0.37.0) (2026-10-17)

### Release correction

The reviewed 0.36 release PR description lost the separators required by
Release Please. Its normal release run skipped publication. The existing release
automation then generated and merged 0.37 before independent candidate acceptance.
That automatic merge did not satisfy the required prepublication review process.
There was no published 0.36 package. The first generated 0.37 notes repeated older
history, including an obsolete package-name change and a withdrawn refund-reader
prototype. Those entries did not describe new 0.37 behavior.

The 0.37 runtime, source, React package, Vite example and packaged guides match
the reviewed 0.36 candidate. The accepted changes since 0.35 are described below;
there is no new package rename in 0.37.

### Features

- Preserve exact original/latest operation evidence through explicit trusted
  maintenance, headerless payload storage and bounded readers. Maintenance
  evidence generations do not observe raw financial writes or establish complete
  lifecycle, ownership, liability or closure coverage.

### Bug fixes

- Qualify ownerless refund-command receipts using a unique immutable original
  settlement allocation with exact charge, PaymentIntent and currency identity.
  Later same-PaymentIntent payment-routing changes cannot reassign the original
  store. Missing allocation proof, payment-only legacy receipts, conflicting
  persisted accounts and ambiguous recipient routes remain unavailable. The
  withdrawn reader based on mutable payment routing is not the final implementation.
- Reuse a validated same-currency earnings summary after the existing subtract,
  reset, reapply and safe-integer checks. This does not fix the native read-limit
  failure for admitted claims with 1,000 distinct destinations.

Automatic publication is separate from independent public-artifact verification
and installed application adoption. These changes do not enable financial
admission, provider execution, refund retry authority, access changes, missing
history migration or account closure readiness.

## [0.36.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.35.0...v0.36.0) (2026-10-17)

### Features

- Preserve exact original/latest operation evidence through explicit trusted
  maintenance, headerless payload storage and bounded read APIs. Maintenance
  evidence generations do not track unobserved raw financial writes or establish
  complete lifecycle, ownership or closure coverage. See the
  [financial observation guide](docs/financial-observations.md).
  ([b409fd4](https://github.com/FantasticDevHQ/better-stripe/commit/b409fd4af5afdec303747c8c5b78accb3ef02ee9))

### Bug Fixes

- Qualify ownerless refund-command receipts against a unique immutable original
  settlement allocation with exact charge, payment intent and currency. Normal
  same-payment routing updates cannot redirect the original store; affiliates,
  replacement stores, conflicting persisted accounts and ambiguous allocation
  routes remain unavailable. Persisted destination-account receipts retain parity.
  ([173f0e1](https://github.com/FantasticDevHQ/better-stripe/commit/173f0e1be7963485ee67042b36704387815f6db0))
- Use component-compatible bounded operation-evidence pagination.
  ([78a524c](https://github.com/FantasticDevHQ/better-stripe/commit/78a524cb13900a2a111183e41ac53cd2e9b038bb))

### Performance

- Reuse one exact same-bucket earnings summary read while preserving subtract,
  zero-count reset, reapply and safe-integer validation before any no-op persistence
  decision. Financial/risk callbacks remain unchanged.
  ([47449d2](https://github.com/FantasticDevHQ/better-stripe/commit/47449d241354eb1e21ef4b3538263b2400c1aa03))

### Scope and limitations

- Original-seller qualification requires immutable allocation authority. Ownerless
  payment-only legacy receipts, missing allocation payment intents and ownerless
  destination history without that authority stay unavailable. Mutable payment
  routing or metadata cannot reconstruct original merchant identity. No migration
  or first-read ownership pin is introduced; existing account-filtered history and
  the 100-row ingestion owner backfill retain their prior limits. Hosts still own
  original command/fingerprint, charge verification and authorization. See the
  [refund-command evidence guide](docs/refund-command-evidence.md).
- The earnings optimization does not fix the admitted 1,000-distinct-destination
  reversal claim's native read-budget failure. Resource failures remain atomic;
  they do not reject the original financial contract by adding a smaller cap or
  truncate transfer references. Existing native document/read/write limits apply.
- Operation evidence remains explicit trusted-maintenance evidence, not automatic
  financial-writer observation, migration/backfill completion, liability admission
  fencing or account-closure readiness. Financial observation coverage remains
  UNKNOWN. No host reconciliation, provider execution, refund retry authority,
  money/access change or Dojo adoption is enabled by this release alone.
- Retain measured stricter quality floors without relaxing existing gates.

## [0.35.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.34.0...v0.35.0) (2026-10-16)

### Features

- **accounts:** register immutable financial bucket ownership ([#248](https://github.com/FantasticDevHQ/better-stripe/issues/248)) ([dbf39fa](https://github.com/FantasticDevHQ/better-stripe/commit/dbf39fa28ce8e5896aad72a7e14eb0d1a6976caf))
- normalize legacy refund-command bindings in bounded batches ([#255](https://github.com/FantasticDevHQ/better-stripe/issues/255)) ([12b431f](https://github.com/FantasticDevHQ/better-stripe/commit/12b431fee421894f752f6742ddf0ce14068b207e))
- observe bounded exact refund-command evidence ([#253](https://github.com/FantasticDevHQ/better-stripe/issues/253)) ([ef8610b](https://github.com/FantasticDevHQ/better-stripe/commit/ef8610b71b5910b7d33ad745224c71590f6db583))
- observe bounded transfer facts and preserve deferred references ([#252](https://github.com/FantasticDevHQ/better-stripe/issues/252)) ([8f951b2](https://github.com/FantasticDevHQ/better-stripe/commit/8f951b2c75737dceb5f074ae375acff84153b170))
- resume every deferred transfer reference ([#254](https://github.com/FantasticDevHQ/better-stripe/issues/254)) ([70ee4b7](https://github.com/FantasticDevHQ/better-stripe/commit/70ee4b76585a2e7ee4acebe54ab92f21b09b1749))
- resume oversized settlement destination indexing ([#251](https://github.com/FantasticDevHQ/better-stripe/issues/251)) ([6870b54](https://github.com/FantasticDevHQ/better-stripe/commit/6870b54055508adcc59b11a1da97d75d6079ff9d))
- observe bounded original settlement destinations ([#250](https://github.com/FantasticDevHQ/better-stripe/pull/250)) ([bfab01e](https://github.com/FantasticDevHQ/better-stripe/commit/bfab01e18b2bbc07b367d7ea2ea12fb78091e20b))

### Scope and limitations

- Ownership registration and financial source observations remain UNKNOWN for
  coverage. They do not certify complete financial history, fence new financial
  work or authorize whole-account closure. Synchronous settlement/transfer
  observations are bounded; oversized source traversal advances through durable
  bounded continuation and validation. A completed pass applies to the observed
  generation, not a permanent quiescence or financial-admission guarantee.
- Exact refund-command evidence observes synchronized original-scope metadata;
  missing, ambiguous, conflicting or unnormalized legacy evidence stays unavailable.
  It never proves provider absence, completed money or safe retry. Legacy
  normalization batches accept 1–100 rows, not a byte guarantee. Native transaction
  or individual-document limits reject atomically and leave the reader held;
  smaller batches do not solve an individual document ceiling.
- The known 1,000-distinct-destination reversal-claim native read-limit failure
  remains unresolved. Passing 1,000 transfers across four shared destinations and
  the historical 1,001-leg release scenario are specific verification cases, not
  general capacity promises. No financial maximum is lowered or error swallowed.
- This release contains accepted additive ownership, observation and refund
  correlation APIs. It does not complete the unfinished example Workflow/Workpool
  migration, producer/backfill/admission chain, account-closure UI or Dojo adoption.
  Public-artifact verification and explicit host adoption remain separate gates.

## [0.34.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.33.0...v0.34.0) (2026-10-16)

### Features

- **accounts:** expose unambiguous personal account mapping ([521b73f](https://github.com/FantasticDevHQ/better-stripe/commit/521b73f4174b620b44abf0c569018e3b08227e3b))
- **accounts:** preserve closed recipient ownership and history ([c14fd3d](https://github.com/FantasticDevHQ/better-stripe/commit/c14fd3d501ef637d33efdf890694156e66328c71))

## [0.33.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.32.0...v0.33.0) (2026-10-16)

### Features

- **billing:** expose bounded authorized refund context ([6f4f264](https://github.com/FantasticDevHQ/better-stripe/commit/6f4f264658d48c478165a4e3f3aaa83e6a6cf94b))
- **billing:** expose bounded buyer Checkout session pages ([f6cb1a6](https://github.com/FantasticDevHQ/better-stripe/commit/f6cb1a64139235ee65f907c3577e4aac75cff96c))

## [0.32.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.31.0...v0.32.0) (2026-10-16)

### Features

- **billing:** expose verified invoice payment references ([dc1245c](https://github.com/FantasticDevHQ/better-stripe/commit/dc1245c686aa924c0920ae5a6cbd1b3fba895713))

## [0.31.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.30.3...v0.31.0) (2026-10-16)

### Features

- **billing:** add scoped provider invoice pages ([255863a](https://github.com/FantasticDevHQ/better-stripe/commit/255863a56b03220f8d8e0322aad7d1fea0ea0fd5))
- **billing:** add scoped provider invoice pages ([05c2ae4](https://github.com/FantasticDevHQ/better-stripe/commit/05c2ae49193ef1d2487f6d968b0d6bdc90309e75))

### Bug Fixes

- **billing:** declare invoice reader runtime dependency ([05fcdee](https://github.com/FantasticDevHQ/better-stripe/commit/05fcdee12aead7df9fd070de5400ae3fac0eb487))

## [0.30.3](https://github.com/FantasticDevHQ/better-stripe/compare/v0.30.2...v0.30.3) (2026-10-16)

### Refactoring

- organize Convex domains and ratchet coverage floors ([#231](https://github.com/FantasticDevHQ/better-stripe/issues/231)) ([c881b44](https://github.com/FantasticDevHQ/better-stripe/commit/c881b44b611f6d979df71a4b540466c0cf28eddf))

## [0.30.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.30.1...v0.30.2) (2026-10-16)

### Bug Fixes

- **example:** complete sandbox fixtures and deferred recovery ([#229](https://github.com/FantasticDevHQ/better-stripe/issues/229)) ([84b0dc6](https://github.com/FantasticDevHQ/better-stripe/commit/84b0dc6f93512ec6021ec5a15b702abd320a7762))

## [0.30.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.30.0...v0.30.1) (2026-10-16)

### Bug Fixes

- **react:** preserve currency units in payout displays ([#227](https://github.com/FantasticDevHQ/better-stripe/issues/227)) ([584df38](https://github.com/FantasticDevHQ/better-stripe/commit/584df3892dd20a1e05276194b0ecd03904afbccf))

## [0.30.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.29.0...v0.30.0) (2026-10-16)

### Features

- **payouts:** adopt complete historical funding ledgers ([#224](https://github.com/FantasticDevHQ/better-stripe/issues/224)) ([7aee88f](https://github.com/FantasticDevHQ/better-stripe/commit/7aee88fb4d4fd043fe3ef117aaa88eddb9b3ab99))

### Bug Fixes

- **payouts:** bound reconciliation and resume activation races ([#226](https://github.com/FantasticDevHQ/better-stripe/issues/226)) ([39832a7](https://github.com/FantasticDevHQ/better-stripe/commit/39832a7b3cb75e7644e38999609da88a9de369ae))

## [0.29.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.6...v0.29.0) (2026-10-15)

### Features

- **payouts:** bind complete history and version recovery liabilities ([#222](https://github.com/FantasticDevHQ/better-stripe/issues/222)) ([65ee1e0](https://github.com/FantasticDevHQ/better-stripe/commit/65ee1e034309d687df9eb989d97437b87f607537))

## [0.28.6](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.5...v0.28.6) (2026-10-15)

### Bug Fixes

- **payouts:** renew verified source freshness per currency ([#220](https://github.com/FantasticDevHQ/better-stripe/issues/220)) ([2ef7b09](https://github.com/FantasticDevHQ/better-stripe/commit/2ef7b0909662db76a4f3692b0eab3923bcd3b48c))

## [0.28.5](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.4...v0.28.5) (2026-10-15)

### Bug Fixes

- **payouts:** expose verified automatic payout attempt results ([#218](https://github.com/FantasticDevHQ/better-stripe/issues/218)) ([826f8fa](https://github.com/FantasticDevHQ/better-stripe/commit/826f8fafdf4a703b5b0662b28bd9ae7505c9d225))

## [0.28.4](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.3...v0.28.4) (2026-10-15)

### Bug Fixes

- **payouts:** retain unresolved recovery after holding expiry ([#216](https://github.com/FantasticDevHQ/better-stripe/issues/216)) ([3ccb39a](https://github.com/FantasticDevHQ/better-stripe/commit/3ccb39adef0f4352cf2992ab73f20a93c84db75d))

## [0.28.3](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.2...v0.28.3) (2026-10-15)

### Bug Fixes

- **payouts:** attempt final payouts before holding deadlines ([#214](https://github.com/FantasticDevHQ/better-stripe/issues/214)) ([44fcac3](https://github.com/FantasticDevHQ/better-stripe/commit/44fcac33f7aa0117f44c584f23ddb185dc32bb55))

## [0.28.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.1...v0.28.2) (2026-10-15)

### Bug Fixes

- **react:** keep payout policy activation unverified until confirmed ([#212](https://github.com/FantasticDevHQ/better-stripe/issues/212)) ([9bf310f](https://github.com/FantasticDevHQ/better-stripe/commit/9bf310f28bd2e690a1f1543b4e15569196b3ba5e))

## [0.28.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.28.0...v0.28.1) (2026-10-15)

### Bug Fixes

- **payouts:** repair scheduled scans and preserve safe reset ([#210](https://github.com/FantasticDevHQ/better-stripe/issues/210)) ([5869570](https://github.com/FantasticDevHQ/better-stripe/commit/586957006690ae7e63efd57db82bcd6859d29a5e))

## [0.28.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.27.0...v0.28.0) (2026-10-15)

### Features

- **payouts:** expose verified carry-forward and payout accounting ([#208](https://github.com/FantasticDevHQ/better-stripe/issues/208)) ([bb3f1aa](https://github.com/FantasticDevHQ/better-stripe/commit/bb3f1aa12a947f463ee43a57c916b8f7bb8a2a8b))

## [0.27.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.26.0...v0.27.0) (2026-10-15)

### Features

- **react:** add reusable payout policy settings and progress ([#206](https://github.com/FantasticDevHQ/better-stripe/issues/206)) ([02dbc96](https://github.com/FantasticDevHQ/better-stripe/commit/02dbc966c065741b72d7a82bfc8f1b714083dc36))

## [0.26.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.25.1...v0.26.0) (2026-10-15)

### Features

- **payouts:** preview combined recipient eligibility without creating payouts ([#204](https://github.com/FantasticDevHQ/better-stripe/issues/204)) ([77db756](https://github.com/FantasticDevHQ/better-stripe/commit/77db756bd57192e841dfdaa11220bfe55e838a2e))

## [0.25.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.25.0...v0.25.1) (2026-10-15)

### Bug Fixes

- **webhooks:** reconcile payout generations before host callbacks ([#202](https://github.com/FantasticDevHQ/better-stripe/issues/202)) ([d8332c4](https://github.com/FantasticDevHQ/better-stripe/commit/d8332c4a3fd98b1cf10e289caa9c476e56b04c79))

## [0.25.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.24.0...v0.25.0) (2026-10-15)

### Features

- **checkout:** expose immutable prepared request execution ([#199](https://github.com/FantasticDevHQ/better-stripe/issues/199)) ([a73454b](https://github.com/FantasticDevHQ/better-stripe/commit/a73454b3027613c5920be79e152610448c9ac70c))
- **payouts:** collect ledger pages and schedule durable payout attempts ([#198](https://github.com/FantasticDevHQ/better-stripe/issues/198)) ([0ed1b2f](https://github.com/FantasticDevHQ/better-stripe/commit/0ed1b2f23ab34301d226fa65fe0c63e093f4f9e1))

## [0.24.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.23.2...v0.24.0) (2026-10-15)

### Features

- add affiliate commission recovery and future earnings offsets ([#191](https://github.com/FantasticDevHQ/better-stripe/issues/191)) ([49f38ac](https://github.com/FantasticDevHQ/better-stripe/commit/49f38ac78f12415d6a330b4729ade56950ee2ad5))

## [0.23.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.23.1...v0.23.2) (2026-10-15)

### Bug Fixes

- **payouts:** reconcile current provider observations with durable generations ([#196](https://github.com/FantasticDevHQ/better-stripe/issues/196)) ([6db9eb2](https://github.com/FantasticDevHQ/better-stripe/commit/6db9eb2c591a99e36bd868cc0581467a2a4564ec))

## [0.23.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.23.0...v0.23.1) (2026-10-15)

### Bug Fixes

- **payouts:** retain original principal for historical returns ([#194](https://github.com/FantasticDevHQ/better-stripe/issues/194)) ([8210c1f](https://github.com/FantasticDevHQ/better-stripe/commit/8210c1f4447528b06d3f098cc85560ff5134b9ba))

## [0.23.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.22.0...v0.23.0) (2026-10-15)

### Features

- **payouts:** adopt historical funding and activate funded policies ([#192](https://github.com/FantasticDevHQ/better-stripe/issues/192)) ([abc73dc](https://github.com/FantasticDevHQ/better-stripe/commit/abc73dccd6398bc6adfab58255e26bbeaa54ab96))

## [0.22.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.21.0...v0.22.0) (2026-10-15)

### Features

- **payouts:** qualify and execute combined recipient releases ([#189](https://github.com/FantasticDevHQ/better-stripe/issues/189)) ([08f4cec](https://github.com/FantasticDevHQ/better-stripe/commit/08f4cecf004635caa42255d4171206e35bda181c))

## [0.21.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.20.1...v0.21.0) (2026-10-15)

### Features

- **payouts:** reconcile verified payout outcomes and fees ([#187](https://github.com/FantasticDevHQ/better-stripe/issues/187)) ([7f14edb](https://github.com/FantasticDevHQ/better-stripe/commit/7f14edb93dcc2c7808f1e3e3f3a8dbe2ff84ad3d))

## [0.20.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.20.0...v0.20.1) (2026-10-15)

### Documentation

- record live saved-card verification and sandbox setup ([#178](https://github.com/FantasticDevHQ/better-stripe/issues/178)) ([18d8b30](https://github.com/FantasticDevHQ/better-stripe/commit/18d8b30cd739c90e68508bd4d119297dc219da5c))

## [0.20.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.19.0...v0.20.0) (2026-10-15)

### Features

- **payouts:** persist source allocations and payout claims ([#184](https://github.com/FantasticDevHQ/better-stripe/issues/184)) ([e99f99e](https://github.com/FantasticDevHQ/better-stripe/commit/e99f99edbec4d1f81988a7854ad26d6fa7ae8a51))

## [0.19.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.18.0...v0.19.0) (2026-10-15)

### Features

- **payouts:** verify recipient transfer funding receipts ([#182](https://github.com/FantasticDevHQ/better-stripe/issues/182)) ([e93d0a7](https://github.com/FantasticDevHQ/better-stripe/commit/e93d0a7a36245b20d568f8c2a3fe117a7f63ea8c))

## [0.18.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.17.1...v0.18.0) (2026-10-15)

### Features

- **payouts:** add durable recipient-held policy controls ([#180](https://github.com/FantasticDevHQ/better-stripe/issues/180)) ([14404c6](https://github.com/FantasticDevHQ/better-stripe/commit/14404c6d3a710c214917657baeb807c180eb1b0f))

## [0.17.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.17.0...v0.17.1) (2026-10-15)

### Bug Fixes

- **ci:** retry release auto-merge on stale head rejection ([#176](https://github.com/FantasticDevHQ/better-stripe/issues/176)) ([a52cbe8](https://github.com/FantasticDevHQ/better-stripe/commit/a52cbe84480ee1fc804240b04a1200468ca57100))
- **earnings:** reject unsafe currency summary arithmetic ([#175](https://github.com/FantasticDevHQ/better-stripe/issues/175)) ([52b6db6](https://github.com/FantasticDevHQ/better-stripe/commit/52b6db6074dc45a7f1d8b2d5f8c62ce3e2261ee8))

### Documentation

- explain evidence uploads, navigation guards and release auto-merge ([#177](https://github.com/FantasticDevHQ/better-stripe/issues/177)) ([a089e78](https://github.com/FantasticDevHQ/better-stripe/commit/a089e78dc6c04a15cb87b1488dd9eecf8cd7fa45))

## [0.17.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.16.0...v0.17.0) (2026-10-15)

### Features

- **refunds:** expose authoritative cursor history ([#172](https://github.com/FantasticDevHQ/better-stripe/issues/172)) ([5943471](https://github.com/FantasticDevHQ/better-stripe/commit/5943471c406d9202e69691eabbdc1839d5b2b5a3))

### Bug Fixes

- **example:** route seller recovery through verified package ledgers ([#173](https://github.com/FantasticDevHQ/better-stripe/issues/173)) ([f361f2e](https://github.com/FantasticDevHQ/better-stripe/commit/f361f2eb7ba46d98898e928b8bcfe7ef3f42150d))

## [0.16.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.15.0...v0.16.0) (2026-10-15)

### Features

- **reads:** currency summaries and reactive cursor contracts ([#170](https://github.com/FantasticDevHQ/better-stripe/issues/170)) ([5ac85e5](https://github.com/FantasticDevHQ/better-stripe/commit/5ac85e59f1769b6485378971d64888d3f7009c1e))

## [0.15.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.14.0...v0.15.0) (2026-10-15)

### Features

- provision payment and saved-card setup intents ([#166](https://github.com/FantasticDevHQ/better-stripe/issues/166)) ([195e4c6](https://github.com/FantasticDevHQ/better-stripe/commit/195e4c630e6f70907405fd9c8aa0d9cfcf17e6d5))

## [0.14.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.13.0...v0.14.0) (2026-10-15)

### Features

- bind dispute evidence uploads and guard onboarding navigation ([#167](https://github.com/FantasticDevHQ/better-stripe/issues/167)) ([e52cd5d](https://github.com/FantasticDevHQ/better-stripe/commit/e52cd5dfc34d3c83a00d2f1686d07af5370b1e60))
- **recovery:** preserve verified opening collections ([#163](https://github.com/FantasticDevHQ/better-stripe/issues/163)) ([e613ac0](https://github.com/FantasticDevHQ/better-stripe/commit/e613ac0d52d1d053b4e3a54dd0394ad1e427c729))

### Bug Fixes

- **recovery:** release unbound void invoice reservations ([#165](https://github.com/FantasticDevHQ/better-stripe/issues/165)) ([a73fd89](https://github.com/FantasticDevHQ/better-stripe/commit/a73fd893370688385fcf9dc2a8dd309d2cbd3ead))

## [0.13.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.12.0...v0.13.0) (2026-10-15)

### Features

- **recovery:** reconcile seller cost invoice adjustments ([#159](https://github.com/FantasticDevHQ/better-stripe/issues/159)) ([d1ffdbc](https://github.com/FantasticDevHQ/better-stripe/commit/d1ffdbcb224b6c31ae958c576a4bcd6ff4a0a4dd))

### Bug Fixes

- **example:** bind reversal inputs to original charge currency ([#160](https://github.com/FantasticDevHQ/better-stripe/issues/160)) ([6b86926](https://github.com/FantasticDevHQ/better-stripe/commit/6b86926c7d4a173babd2964d4eee086f61c48f63))
- **example:** reconcile unsettled disputed sources ([#161](https://github.com/FantasticDevHQ/better-stripe/issues/161)) ([9c732bd](https://github.com/FantasticDevHQ/better-stripe/commit/9c732bdc88555210d2172067e6bbf5d2fc513190))
- **react:** isolate refund preview amounts by currency and status ([#162](https://github.com/FantasticDevHQ/better-stripe/issues/162)) ([601d509](https://github.com/FantasticDevHQ/better-stripe/commit/601d50923dc98f212b29fd4e4e3d856dfffbda44))
- **react:** preserve original refund currency units ([#157](https://github.com/FantasticDevHQ/better-stripe/issues/157)) ([494827f](https://github.com/FantasticDevHQ/better-stripe/commit/494827f1cb35b0b0ca10b1c6da38a1095bb32500))

## [0.12.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.11.0...v0.12.0) (2026-10-15)

### Features

- **billing:** add consented balance funding operations ([#149](https://github.com/FantasticDevHQ/better-stripe/issues/149)) ([16434c4](https://github.com/FantasticDevHQ/better-stripe/commit/16434c4eeef343045b4ba66516221232dfa57e06))
- **billing:** expose complete upcoming invoice previews ([#147](https://github.com/FantasticDevHQ/better-stripe/issues/147)) ([6d81cec](https://github.com/FantasticDevHQ/better-stripe/commit/6d81cec1b458fadbe4aeb69b9611d6ba208d87ce))
- **recovery:** add durable cost claims and reservations ([#151](https://github.com/FantasticDevHQ/better-stripe/issues/151)) ([a958c3a](https://github.com/FantasticDevHQ/better-stripe/commit/a958c3aa12178de4f22c0c614b0b9e5d7eb37819))
- **settlement:** expose complete processing cost context ([#150](https://github.com/FantasticDevHQ/better-stripe/issues/150)) ([3933d6b](https://github.com/FantasticDevHQ/better-stripe/commit/3933d6bf3c54181e8f7c27b35e6eb6802fb7c2d8))

### Bug Fixes

- **react:** preserve charge currency units in price cards ([#155](https://github.com/FantasticDevHQ/better-stripe/issues/155)) ([b0967ae](https://github.com/FantasticDevHQ/better-stripe/commit/b0967ae61ac8ae85adc4f2d8f375e2c71ad1464f))
- **react:** preserve plan pricing currency units ([#156](https://github.com/FantasticDevHQ/better-stripe/issues/156)) ([f65e712](https://github.com/FantasticDevHQ/better-stripe/commit/f65e712a91dd55e6979ccea540627d4c437dfc6c))
- **release:** keep generated notes public ([#153](https://github.com/FantasticDevHQ/better-stripe/issues/153)) ([d67f21a](https://github.com/FantasticDevHQ/better-stripe/commit/d67f21a6315c0498db7358b6b37669520037fefa))
- **release:** preserve historical code examples ([#154](https://github.com/FantasticDevHQ/better-stripe/issues/154)) ([1c3c9f0](https://github.com/FantasticDevHQ/better-stripe/commit/1c3c9f0a63e7c5eb77e685dc0bb3963a4e7dc935))
- **webhooks:** reconcile dedicated payout cancellations ([#152](https://github.com/FantasticDevHQ/better-stripe/issues/152)) ([9dd84e2](https://github.com/FantasticDevHQ/better-stripe/commit/9dd84e22473a35445a0445a82e8fcdf2eb9ace23))

## [0.11.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.10.2...v0.11.0) (2026-10-14)

### Features

- add retry-safe catalog creation request keys ([#145](https://github.com/FantasticDevHQ/better-stripe/issues/145)) ([45b0d52](https://github.com/FantasticDevHQ/better-stripe/commit/45b0d52dfcb6577cf5df339721ed9eed34a83a1d))

## [0.10.2](https://github.com/FantasticDevHQ/better-stripe/compare/v0.10.1...v0.10.2) (2026-10-14)

### Bug Fixes

- sync portal cancellations and clarify preview setup ([#143](https://github.com/FantasticDevHQ/better-stripe/issues/143)) ([62998ae](https://github.com/FantasticDevHQ/better-stripe/commit/62998aed54946711619a3af82ad44b6cf8406abc))

## [0.10.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.10.0...v0.10.1) (2026-10-14)

### Bug Fixes

- support customer-only Accounts v2 preview configuration ([#141](https://github.com/FantasticDevHQ/better-stripe/issues/141)) ([e58905d](https://github.com/FantasticDevHQ/better-stripe/commit/e58905d1c588995cac55ae0f5b830f785ff65f75))

## [0.10.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.9.0...v0.10.0) (2026-10-14)

### Features

- expose reusable settlement, payouts, and resilient billing APIs ([#139](https://github.com/FantasticDevHQ/better-stripe/issues/139)) ([a88e9ea](https://github.com/FantasticDevHQ/better-stripe/commit/a88e9eae5aa12e32c108ea16c19f5b6e8870f7e4))

## [0.9.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.8.1...v0.9.0) (2026-10-14)

### Features

- configure store pricing and affiliate commissions ([#137](https://github.com/FantasticDevHQ/better-stripe/issues/137)) ([aa7181e](https://github.com/FantasticDevHQ/better-stripe/commit/aa7181ecc23b5c38f3eb0f6480399cf5736332f6))

## [0.8.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.8.0...v0.8.1) (2026-10-13)

### Bug Fixes

- harden sandbox example and reusable React workflows ([#135](https://github.com/FantasticDevHQ/better-stripe/issues/135)) ([65985a5](https://github.com/FantasticDevHQ/better-stripe/commit/65985a5be392e3bcb04c4055fb36515ba02de0b2))

## [0.8.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.7.0...v0.8.0) (2026-10-13)

### Features

- compare checkout and embedded integration examples ([#133](https://github.com/FantasticDevHQ/better-stripe/issues/133)) ([0d916f6](https://github.com/FantasticDevHQ/better-stripe/commit/0d916f6aecf734877da379327a3148753fc0c4c3))
- ship reusable React workflows and migrate the example UI ([#134](https://github.com/FantasticDevHQ/better-stripe/issues/134)) ([a1336ce](https://github.com/FantasticDevHQ/better-stripe/commit/a1336ced2a6d3a09210e769a89cf70022c0f7531))

### Maintenance

- add repo-gates and enforce check:all ([#131](https://github.com/FantasticDevHQ/better-stripe/issues/131)) ([be80b7f](https://github.com/FantasticDevHQ/better-stripe/commit/be80b7f8fe186bc22dbdc956357bd4a1120eec29))

## [0.7.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.6.1...v0.7.0) (2026-10-13)

### Features

- expand marketplace example with seller billing and sandbox fixtures ([#129](https://github.com/FantasticDevHQ/better-stripe/issues/129)) ([7f21f53](https://github.com/FantasticDevHQ/better-stripe/commit/7f21f5365ce82cab9ecc984b94f444408223f8b8))

## [0.6.1](https://github.com/FantasticDevHQ/better-stripe/compare/v0.6.0...v0.6.1) (2026-10-13)

### Bug Fixes

- complete large split reversals and keep public docs current ([#127](https://github.com/FantasticDevHQ/better-stripe/issues/127)) ([e7cc0a9](https://github.com/FantasticDevHQ/better-stripe/commit/e7cc0a9b0ea01f4993447f9d73edebe71b364081))

## [0.6.0](https://github.com/FantasticDevHQ/better-stripe/compare/v0.5.0...v0.6.0) (2026-10-12)

### ⚠ BREAKING CHANGES

- the package name changes to @fantastic.dev/better-stripe; @getdojo/better-stripe receives no further releases.

### Features

- complete Stripe Endive compatibility and release 0.5.0 ([#126](https://github.com/FantasticDevHQ/better-stripe/issues/126)) ([135695f](https://github.com/FantasticDevHQ/better-stripe/commit/135695f51906ea156a36dbe8d0d43cf1d99e5fc1))
- publish as [@fantastic](https://github.com/fantastic).dev/better-stripe via Release Please and trusted publishing ([#120](https://github.com/FantasticDevHQ/better-stripe/issues/120)) ([7451eeb](https://github.com/FantasticDevHQ/better-stripe/commit/7451eeb514b09a09656355c74c4bec083e1ddce7))

### Bug Fixes

- repair example checkout billing and seller flows ([#125](https://github.com/FantasticDevHQ/better-stripe/issues/125)) ([5911fb8](https://github.com/FantasticDevHQ/better-stripe/commit/5911fb8d8bc585fab62fe48e58e1e964047b8fd9))

### Maintenance

- **deps:** update dependencies to latest ([#122](https://github.com/FantasticDevHQ/better-stripe/issues/122)) ([a7e4161](https://github.com/FantasticDevHQ/better-stripe/commit/a7e416179d20afdd2356668cbd4482e2e3fa4eff))

### Continuous Integration

- **release:** open release PRs with the org release GitHub App ([#124](https://github.com/FantasticDevHQ/better-stripe/issues/124)) ([3c94f2e](https://github.com/FantasticDevHQ/better-stripe/commit/3c94f2ef317f939ac039c261f9c148e6b1f14a56))

## 0.5.0

### Features

- Incorporate Dojo's `retryOnHookError` webhook patch upstream. Selected,
  signature-verified V1 `onEvent`/event hooks must succeed before acknowledgment;
  failed hooks and unavailable ledger writes return 500, in-flight deliveries
  return 503, and successful redelivery deduplicates. The default remains
  best-effort. Add regression coverage using real SDK signatures and the real
  Convex component ledger, including stale-reservation recovery.

### Bug Fixes

- Complete support for Stripe API **`2026-09-30.endive`** with stripe-node
  **23.0.0** (already pinned in the 0.4.0 checkout). Verify both client factories'
  outgoing version headers against the typed single-source API constant.
- Preserve verified V2 notification context when retrieving accounts; accept
  related-object pointers without an id and resolve accounts from their URL.
- Map Endive `rejected`/`restricted` capabilities to `restricted` and pending
  capabilities to `in_progress`, including nested Stripe balance capabilities.
- Remount embedded Checkout when its key/client secret changes, using React
  Stripe.js 7's current `createEmbeddedCheckoutPage` integration.
- Deprecate the retained, ignored V2 account-link `configurations` option and
  remove its obsolete internal use.

### Migration

See [MIGRATION.md](MIGRATION.md) for removing the Dojo pnpm patch, upgrading
0.2.0 webhook wiring, billing-anchor/payment-method request changes, and
**separate consumer-controlled webhook destination upgrades**. The public
`V2ThinEvent.related_object.id` is now optional; consumers must guard it.
No account defaults, event destinations, DNS, or production deployments are
changed by this release.

## 0.4.0

**Renamed to `@fantastic.dev/better-stripe`.** This is the first release under the new name, published from `FantasticDevHQ/better-stripe` through npm trusted publishing with provenance. `@getdojo/better-stripe` is deprecated and gets no further releases. To migrate, replace `@getdojo/better-stripe` with `@fantastic.dev/better-stripe` in `package.json`, in imports and in `convex.config.ts`, then run `npx convex dev` to regenerate `_generated/`. The API is unchanged by the rename.

`0.3.0` was versioned but never published, so this release also ships everything listed under `0.3.0` below, including its breaking webhook-wiring change.

### Minor Changes

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `getAccountBalance` for per-account balance retrieval ([#62](https://github.com/kellykampen/better-stripe/issues/62)).

  New `BetterStripe.getAccountBalance({ stripeAccountId })` reads a connected account's live Stripe balance, scoped via the `Stripe-Account` header (mirroring the other per-account calls like `createPayout`). Pairs Stripe's separate `available`/`pending` per-currency lists into one `AccountBalance` (`{ available, pending, currency }`, minor units) per currency — a currency present on only one side defaults to `0` on the other. `AccountBalance` is re-exported at the package root, and its shape matches the `PayoutSchedule` component's `balance` prop directly.

  Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add headless `BuyerBillingView` component ([#50](https://github.com/kellykampen/better-stripe/issues/50)).

  The buyer's embedded-only, in-app billing surface: shows a buyer's subscriptions grouped by store (via the existing `groupSubscriptionsByStore` util, not recomputed), with per-store cancel/reactivate through the shared `SubscriptionCard`/`SubscriptionActions`, the one saved payment method reusable across every store, and an embedded (no-redirect) card-update slot.

  React-surface only — no server/schema changes, no new dependencies. Full headless convention: `className`, per-label i18n overrides, `children` render-prop, loading/empty states. Purely additive.

- [#22](https://github.com/kellykampen/better-stripe/pull/22) [`ad52d4a`](https://github.com/kellykampen/better-stripe/commit/ad52d4a083d27b1c82f5a043043a988fc60e8fed) Thanks [@kellykampen](https://github.com/kellykampen)! - Add support for the V2 **customer configuration** — the billable entity in the V2 Accounts API, where a single Account with a customer configuration replaces the legacy V1 Customer object.

  - `BetterStripe.addCustomerConfiguration(ctx, { stripeAccountId })` — applies the customer configuration to an existing account (making it usable in customer-facing payment/billing flows: subscriptions, invoices, and the billing portal via `customer_account: acct_…`), re-reads the configurations Stripe actually applied, and records them on the component account. Throws `ACCOUNT_NOT_FOUND` (without touching Stripe) if the account isn't in the component DB. Returns `{ success: true, appliedConfigurations }`.
  - `BetterStripe.DEFAULT_CUSTOMER_CONFIGURATION` — the documented `{ customer: {} }` preset. Request `customer.capabilities.automatic_indirect_tax` separately if you need automatic tax on this account's invoices/subscriptions.

  Previously `DEFAULT_ACCOUNT_CONFIGURATION` only requested the merchant configuration, so there was no first-class path to create a customer-billable account.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `DisputeDetail` + `EvidenceForm` headless React components ([#40](https://github.com/kellykampen/better-stripe/issues/40)).

  - `DisputeDetail` — renders a dispute's amount, reason, status, evidence-due countdown message, and linked transfer ids. Loading/empty states, i18n label overrides.
  - `EvidenceForm` — headless controlled form for the four Skool-style evidence fields (product description, access activity, additional info, customer communication); `stage()` saves a draft (no `submit` key), `submit()` finalizes with `submit: true`. Supports `stripeAccountId` scoping and `onStaged`/`onSubmitted`/`onError` callbacks.

  Both are headless/themeable (`className` plus a `children` render-prop) and consume the existing dispute handling/dispute hooks core with no duplicated logic. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add headless `DisputesList` component with due-by countdown badges ([#41](https://github.com/kellykampen/better-stripe/issues/41)).

  Pure, hook-free presentational list of a seller's disputes, sorted by evidence deadline (soonest first, no-deadline rows last, overdue rows naturally at the top). Rows accept the exact shape `getDisputeWithCountdown`/`useDisputeWithCountdown` produce, so the component never recomputes deadlines itself.

  Headless overrides: `className`, i18n labels (`emptyLabel`, `loadingLabel`, `dueLabel`/`overdueLabel` with `{days}` templating), a per-row `renderRow` slot, and a whole-list `children` render prop. Default markup is semantic `ul[role=list] > li[data-dispute-id]` with a `span[role=status]` badge carrying `data-overdue`. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add dispute React hooks: `createUseDisputes` + `createUseDisputeWithCountdown` ([#36](https://github.com/kellykampen/better-stripe/issues/36)).

  Two new factory hooks following the existing `createUse*` convention:

  - `createUseDisputes` — wraps `listDisputes` with `account`/`status` filters (list-style, mirrors `createUseInvoices`); returns `{ disputes, isLoading }`.
  - `createUseDisputeWithCountdown` — wraps `getDisputeWithCountdown` for a single dispute id (mirrors `createUseSubscription`); returns `{ dispute, countdown, isLoading }`, using Convex's `"skip"` sentinel when no id is provided.

  Both wired into the `@getdojo/better-stripe/react` entry export; `StripeComponentDispute` re-exported for consumers. Purely additive.

- [#51](https://github.com/kellykampen/better-stripe/pull/51) [`6345352`](https://github.com/kellykampen/better-stripe/commit/6345352cf4b3ad4247c865090693e877da6bf5ef) Thanks [@kellykampen](https://github.com/kellykampen)! - Smart-retry dunning: surface failed subscription cycles.

  `invoice.payment_failed` previously upserted the invoice but fired **no** async hook, so apps couldn't react to a failed subscription cycle. It now schedules a new invoice-level hook:

  - **`AsyncHooks.onInvoicePaymentFailed(ctx, invoice)`** — fires on `invoice.payment_failed` (mapped to the internal `afterInvoicePaymentFailed` hook). This is the invoice-level (subscription-cycle) failure, distinct from `onPaymentFailed`, which fires on a one-time **PaymentIntent** failure and receives a payment, not an invoice. The delinquency transition itself (`past_due` → `unpaid`) still arrives via `customer.subscription.updated` → `onSubscriptionUpdated`.

  **Retry metadata on the invoice row** (two new optional fields, additive — no migration): `nextPaymentAttempt` (ISO time of Stripe's next Smart Retry) and `attemptCount`. The dunning hook receives these on the committed invoice so an email can tell the buyer when Stripe will retry.

  **No custom retry loop.** Recovery timing is owned by Stripe Smart Retries — enable it in the Dashboard (Billing → Revenue recovery → Retries for subscriptions; Settings → Billing → Invoices for one-time invoices). See the README "Dunning & smart retries" section.

  **Breaking (pre-1.0):** the internal `AsyncHookName` union grew by `afterInvoicePaymentFailed`. Apps using the recommended `webhookHandlers()` + `webhooks: internal.stripe` wiring need **no changes** — the pair is unchanged and the new hook field is optional.

  Note: covered by unit tests (hook scheduling, invoice state transition + retry metadata, `past_due`/`unpaid` persistence). The live `invoice.payment_failed` path (real failed-card subscription cycle) should be exercised by the E2E webhook run before release.

- [#64](https://github.com/kellykampen/better-stripe/pull/64) [`477e282`](https://github.com/kellykampen/better-stripe/commit/477e282ea1cfd2fc198f1aa19cc376eea96b38ca) Thanks [@kellykampen](https://github.com/kellykampen)! - Exact earnings totals — fix silently truncated financial figures past 50 rows.

  `listTransfersByAccount` and `listPayouts` cap their results at 50 rows, and the `useEarnings` hook summed those rows client-side — so an account with more than 50 transfers or payouts reported **silently wrong** (understated) gross / reversed / net / paid-out totals, with no error.

  **Fix:** two new server-side aggregate queries sum the account's whole ledger, paginated to completion, so totals are exact regardless of row count:

  - **`connect/queries/getAccountEarnings({ destinationAccountId, previewLimit? })`** → `{ gross, reversed, transferCount, transfers }`. Exact `gross`/`reversed` over every transfer (incl. reinstatements — the earnings view); `transfers` is a bounded preview (`previewLimit ?? 50`) for drill-down.
  - **`connect/queries/getAccountPayouts({ accountId, previewLimit? })`** → `{ paidOut, payoutCount, payouts }`. Exact `paidOut` over every `paid` payout; `payouts` is a bounded preview.

  Exact up to Convex's per-query read limit; beyond that the query throws (loud) rather than silently truncating — strictly safer than a fixed cap for money figures.

  **`createUseEarnings` now wires these aggregate queries** instead of the capped list queries. Its factory still takes `(useQuery, earningsQueryRef, payoutsQueryRef)` — point the refs at `getAccountEarnings` / `getAccountPayouts`. `UseEarningsResult` keeps `gross`/`reversed`/`net`/`paidOut`/`payouts`/`transfers` (now exact totals + a bounded preview) and adds `transferCount` / `payoutCount` for "showing N of M" UIs. `EarningsSummary` is unaffected (it reads the same figures).

  **Behavior change:** if you wired `createUseEarnings` against `listTransfersByAccount` / `listPayouts`, repoint the refs at the new aggregate queries. The list queries and `BetterStripe.listPayouts()` are unchanged, now documented as capped drill-down views. `listTransfersByCharge` (per-sale split legs) is unchanged and safe in practice — a sale has few legs.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `createUseEarnings` + `createUseSplitBreakdown` React hook factories ([#44](https://github.com/kellykampen/better-stripe/issues/44)).

  - `createUseEarnings(useQuery, transfersRef, payoutsRef)` → `useEarnings(accountId)` reads a recipient's transfer ledger and payouts, deriving `gross` (total transferred in), `reversed` (pulled back via fee collection + refund/dispute clawbacks — deliberately not labeled "fees", since a true platform-fees figure lives on the payments rows' `feeCollectedAmount`), `net`, `payouts`/`paidOut`, and the raw `transfers` for drill-down.
  - `createUseSplitBreakdown(useQuery, transfersByChargeRef)` → `useSplitBreakdown({ sourceChargeId, saleAmount? })` sums a sale's split legs by role (`store`/`affiliate`/`other`), each net of reversals, with the `platform` share derived when the caller supplies the sale amount.

  Both follow the `createUse*` factory convention from dispute hooks. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add embedded Stripe Connect dispute components ([#48](https://github.com/kellykampen/better-stripe/issues/48)).

  The Stripe-hosted alternative to the headless dispute components, built on `@stripe/react-connect-js`:

  - `ConnectProvider` — initializes ConnectJS once per mount via `loadConnectAndInitialize({ publishableKey, fetchClientSecret, appearance?, locale? })` and provides the instance through `ConnectComponentsProvider`. `fetchClientSecret` wires to an app action wrapping `stripe.createDisputeSession({ stripeAccountId })`.
  - `EmbeddedDisputes` — mounts Stripe's `disputes_list` embedded component, or `payment_disputes` scoped to one payment via the `payment` prop. Must render inside `ConnectProvider`.

  Adds `@stripe/connect-js` and `@stripe/react-connect-js` as regular dependencies, mirroring the existing `@stripe/stripe-js`/`@stripe/react-stripe-js` convention. Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add headless `PayoutSchedule` component for recipient balance + payout display ([#46](https://github.com/kellykampen/better-stripe/issues/46)).

  Pure, hook-free component showing a seller's available/pending balance (from a `RecipientBalance` snapshot prop) and next payout — the earliest `pending`/`in_transit` payout row with an arrival date, templated as "Next payout of $40.00 expected Jul 10, 2026", falling back to a rolling-schedule message when none is upcoming (payouts are automatic/rolling; the component deliberately offers no manual withdrawal). Optional `manageUrl` link out to the hosted Express dashboard.

  Headless conventions: `className`, i18n label overrides, loading/empty states, and a `children` render-prop with all computed state. Data comes entirely via props (no data-fetching hook yet); purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add product-level `statement_descriptor` so it covers a subscription's first charge ([#63](https://github.com/kellykampen/better-stripe/issues/63)).

  The invoice-time descriptor path sets the descriptor at `invoice.created`, which never reaches a subscription's first invoice — Stripe finalizes and (for `charge_automatically`/Checkout subscription-mode) pays invoice [#1](https://github.com/kellykampen/better-stripe/issues/1) synchronously at creation, before that handler runs. Per Stripe's descriptor precedence (Invoice → Product → charge-type default), a product-level `statement_descriptor` covers every cycle including the first.

  `createProduct`/`updateProduct` now resolve the per-store descriptor (the store's stored suffix, else the platform default — mirroring the account-level descriptor resolution) and stamp it onto the Stripe Product's `statement_descriptor`, for products with an `accountId`. No public API change to existing call shapes.

- [#70](https://github.com/kellykampen/better-stripe/pull/70) [`306d402`](https://github.com/kellykampen/better-stripe/commit/306d402b0148e0794a2239a5c83a0d3780300c38) Thanks [@kellykampen](https://github.com/kellykampen)! - Reclaim/expiry of dead reversal claims.

  Atomic reversal claims reserve reversal slices atomically before money moves; the executor now refuses to leapfrog an unexecuted predecessor claim. The residual, by-design failure mode: if the operation that reserved a slice dies permanently (its webhook exhausts Stripe's retries and never confirms), the claim frontier stays ahead of the confirmed `reversedAmount` forever, and every successor reversal on that leg blocks with `predecessor claim unexecuted`. This adds an ops path to resolve such wedged legs.

  - **`BetterStripe.listWedgedReversalClaims(ctx)`** — lists legs where `reversalClaimedAmount > reversedAmount` and the recorded ops holding the blocking (unexecuted) slice on each. An ops/admin diagnostic; scans the ledger to completion (exact, and loud past Convex's 16,384-doc read limit rather than silently truncating).
  - **`BetterStripe.reclaimReversalClaim(ctx, { operationId, mode })`** — resolves a dead claim:
    - `mode: "reexecute"` (default, always safe): replays the op's recorded slices under the original `bs_rev_<opId>_<transferId>` idempotency keys, moving any money that never moved and recording any that moved-but-wasn't-confirmed. Fills the hole so blocked successors proceed; cannot double-reverse.
    - `mode: "release"`: abandons the claim (rewinds each leg's frontier to the pre-claim amount and deletes the op record). Gated on BOTH the op being older than `minAgeMs` (default ~24h, past Stripe's idempotency-key window) AND live Stripe `amount_reversed ≤ slice.from` on every leg; the component mutation additionally refuses if a successor already claimed past the slice (re-execute instead).

  New component functions: `connect/queries/listWedgedReversalClaims`, `connect/queries/getReversalOp`, `connect/mutations/releaseReversalClaim`. No behavior change to existing reversal paths.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add refund actor scoping — seller (own sales) vs platform admin ([#56](https://github.com/kellykampen/better-stripe/issues/56)).

  `createRefund` previously had no notion of who may initiate a refund. It now takes an optional `actor` option (`{ type: "admin" }` or `{ type: "seller", accountId }`) and enforces the rule before any Stripe call is made — an unauthorized refund never moves money. A platform admin may refund any sale; a seller may refund only sales routed to their own connected account (destination charge, or one of the split legs in a separate-charges split), resolved from the payment's own component-ledger routing. Fails closed: a seller is denied when the payment's routing can't be resolved.

  Additive and backwards compatible — omitting `actor` preserves the prior unrestricted behavior. The refund fee/transfer-reversal math from refund handling is unchanged.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Refunds now return the platform fee pro-rata and reverse recipient transfers ([#45](https://github.com/kellykampen/better-stripe/issues/45)).

  **Destination charges:** `createRefund` gains `refundApplicationFee` and `reverseTransfer` options, both defaulting `true`, sent only when the charge actually carries an application fee / destination transfer (sending either on an incapable charge is a hard Stripe error). Stripe pro-rates both natively for partial refunds; an explicit `false` always wins.

  **Split sales (transfer math):** a new `reverseTransfersForRefund` (driven from `refund.created`/`refund.updated`, so pending→succeeded ACH refunds and Dashboard-issued refunds both claw back) converges each ledger leg on a cumulative reversal target — `round(leg × amount_refunded / amount)` — and reverses only the delta above the already-recorded amount, so at-least-once webhook delivery can't double-record the ledger or trip Stripe idempotency-key conflicts.

  Additive; no breaking changes to `createRefund`'s existing call shape.

- [`11425b3`](https://github.com/kellykampen/better-stripe/commit/11425b3d91da6fd87650569c015de1bb75b7e61e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add refund and dispute tracking (plan 011).

  **New webhook events** added to `BETTER_STRIPE_WEBHOOK_EVENTS` (add these to your event destination / endpoint's `enabledEvents`):

  - Refunds: `refund.created`, `refund.updated`, `refund.failed`
  - Disputes: `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`

  **New component tables:** `refunds` and `disputes`, synced from those events. Refunds denormalize cumulative state onto the linked `payments` row — two new optional fields, `refundedAmount` and `refundStatus` (`"partially_refunded" | "fully_refunded"`) — so consumers can answer "is this payment whole?" in a single read. Both additions are optional/additive (no migration required).

  **New `BetterStripe` methods:**

  - `createRefund`, `getRefundByStripeId`, `listRefunds`
  - `getDisputeByStripeId`, `listDisputes`, `updateDispute` (submit evidence), `closeDispute`

  **New triggers/hooks:** `SyncTriggers.refund` / `SyncTriggers.dispute` (sync, same-transaction) and `AsyncHooks.onRefundCreated` / `onDisputeCreated` / `onDisputeClosed` (async, after-commit).

  **Breaking (pre-1.0):** the internal `TriggerDispatcherName` / `AsyncHookName` unions grew (added `refundUpserted`, `disputeUpserted`, `afterRefundCreated`, `afterDisputeCreated`, `afterDisputeClosed`). Apps using the recommended `webhookHandlers()` + `webhooks: internal.stripe` wiring need **no changes** — the pair is unchanged and all trigger/hook fields are optional. No app-level migration is required.

  Note: V2 `customer_account` + `pause_collection`/dispute interplay and the refund-via-API path are covered by unit tests; the live E2E (`refund.created` via real API call, dispute triggers) should be run before release — `charge.dispute.funds_withdrawn`/`funds_reinstated` cannot be reliably triggered in test mode.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `SplitBreakdown` + `EarningsSummary` headless components ([#49](https://github.com/kellykampen/better-stripe/issues/49)).

  - `SplitBreakdown` renders a sale's store + affiliate + platform lines (the `other` bucket only when it carries money) from `useSplitBreakdown`'s totals. When the platform share is underivable (no sale amount given to the hook) it renders an explicit "Unknown without the sale amount" state — never a silent zero.
  - `EarningsSummary` renders gross / reversals / net / paid-out plus the latest payout status line. Its props are a subset of `useEarnings`'s result shape, so `<EarningsSummary {...useEarnings(accountId)} />` works directly.

  Consumes the earnings hooks hooks ([#44](https://github.com/kellykampen/better-stripe/issues/44)). Both headless/themeable (`className` + `children` render-prop). Purely additive.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Add per-store statement descriptors on destination charges ([#47](https://github.com/kellykampen/better-stripe/issues/47)).

  - New `BetterStripe.setAccountStatementDescriptor` method (validates first; `null` clears) writes a `statementDescriptor` field on the component's account record via a new `core/mutations/setStatementDescriptor` mutation.
  - New constructor option `statementDescriptorSuffix` sets a configurable platform-wide default (validated at construction, same pattern as `platformFee`), used whenever a store account carries no suffix of its own. Resolution order: store's stored suffix → configured default → none.
  - Applied on every destination charge: one-time payment mode sets `payment_intent_data.statement_descriptor_suffix` at session creation; subscriptions (which can't carry a suffix directly) stash the resolved value as a `bsStatementDescriptor` metadata marker, applied by a new `applyStatementDescriptor` webhook processor.

  Purely additive — no existing method signatures change.

- [`a821651`](https://github.com/kellykampen/better-stripe/commit/a82165187295c1b0992726566d9e96060370a0eb) Thanks [@kellykampen](https://github.com/kellykampen)! - Expand the subscription write surface with five new `BetterStripe` methods, all routing through the component's webhook-sync path (`customer.subscription.updated` → `subscriptionUpserted`) and returning `{ success: true }`:

  - `pauseSubscription` — sets `pause_collection` (defaults `behavior: "keep_as_draft"`, optional `resumesAt`).
  - `resumeSubscription` — clears `pause_collection` via the empty-string sentinel.
  - `updateSubscriptionPrice` — swaps the first item's price; defaults `prorationBehavior: "none"` (no proration line items), caller-overridable.
  - `updateSubscriptionMetadata` — merges/upserts metadata keys (existing keys not included are preserved).
  - `updateSubscriptionTrialEnd` — extends or ends a trial (`"now"` or a Unix timestamp).

  Also: the existing `cancelSubscription`, `reactivateSubscription`, and `updateSubscriptionQuantity` now wrap their Stripe SDK calls in `throwStripeError`, so failures surface as a structured `ConvexError<BetterStripeError>` (`STRIPE_API_ERROR`) instead of a raw `Error`.

- [#54](https://github.com/kellykampen/better-stripe/pull/54) [`3c5f07b`](https://github.com/kellykampen/better-stripe/commit/3c5f07bbd89f1461f616be04fa2bf23276487377) Thanks [@kellykampen](https://github.com/kellykampen)! - Add `BetterStripe.listTransfersByCharge` and `BetterStripe.listTransfersByAccount` — client read wrappers over the component's transfer-ledger queries.

  - `listTransfersByCharge(ctx, { sourceChargeId, limit? })` — a sale's original split legs (reinstatement rows excluded), the read behind the `useSplitBreakdown` hook / per-sale breakdown UIs.
  - `listTransfersByAccount(ctx, { destinationAccountId, limit? })` — a recipient's transfer ledger (the earnings view, includes reinstatements), the read behind the `useEarnings` hook.

  The underlying component queries already existed, but there was no client-side method to reach them, so an app couldn't wire the `useSplitBreakdown` / `useEarnings` hook factories to real data. These thin read wrappers close that gap (surfaced while building the affiliate-split demo).

- [#58](https://github.com/kellykampen/better-stripe/pull/58) [`61f755e`](https://github.com/kellykampen/better-stripe/commit/61f755ebf38065d5c3cc73db18e7dfd1c3d8c394) Thanks [@kellykampen](https://github.com/kellykampen)! - `updateDispute` now stages evidence by default instead of submitting it.

  Stripe's dispute-update `submit` parameter **defaults to `true`**, so evidence sent without an explicit `submit` is submitted to the bank — a one-shot, outcome-affecting action. The previous docblock incorrectly said omitting `submit` "saves a draft", and the method forwarded `submit` only when explicitly set, so a caller following the docs would submit unintentionally.

  **Behavior change:** when `evidence` is provided **without** an explicit `submit`, `updateDispute` now sends `submit: false` (stages a draft). Callers must pass `submit: true` to finalize and submit to the bank.

  - A bare metadata/status update (no `evidence`) is unchanged — no `submit` is forced.
  - An explicit `submit: true` / `submit: false` is always honored.
  - `EvidenceForm` already passes `submit` explicitly, so it is unaffected.

  If you relied on the old behavior of submitting evidence by omitting `submit`, pass `submit: true` explicitly.

### Patch Changes

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Regenerate the component's `_generated` API so transfer/dispute queries are typed for consumers ([#71](https://github.com/kellykampen/better-stripe/issues/71)).

  `src/component/_generated/component.ts` was stale — it predated `listTransfersByCharge`/`listTransfersByAccount` and `getDisputeByStripeId`/`listDisputes`, so `components.betterStripe.connect.queries.*` for those methods was untyped for any consumer reaching into the raw component API. Regenerated via `npx convex codegen`; no source logic changed, generated bindings only.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix: `updateDispute` now sends an explicit `submit: false` on every call, including metadata-only updates ([#67](https://github.com/kellykampen/better-stripe/issues/67)).

  Earlier evidence handling made evidence-bearing `updateDispute` calls stage by default (`submit: false`), but left metadata-only updates sending no `submit` key at all — inheriting Stripe's server-side default, which Stripe's docs state is `true` on every update. Empirically, a metadata-only update does not submit previously staged evidence today, but that leniency contradicts the documented default and submission is one-shot and outcome-affecting. `updateDispute` now never omits `submit`: every call — evidence, metadata, or both — sends an explicit `submit: false` unless the caller passes `submit: true` to finalize.

  No public API change; the safer default only ever narrows behavior (no call that previously submitted now stages, and vice versa).

- [#68](https://github.com/kellykampen/better-stripe/pull/68) [`4d1b843`](https://github.com/kellykampen/better-stripe/commit/4d1b843cb9891a313c9b9a270ca067e36c686420) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix a first-invoice fee double-reversal crack.

  `applyFirstInvoiceFee` recomputed the platform fee from **live** subscription metadata (`bsFeeConfig`) on every webhook retry. If the transfer reversal succeeded but the `bsFeeCollected` invoice-marker write then failed (event marked `failed`), and the platform edited `bsFeeConfig` before Stripe redelivered, a retry landing **after** Stripe's ≤24h idempotency-key window would recompute a _different_ fee and create a **second** reversal — double-collecting the fee.

  **Fix:** before reversing, `applyFirstInvoiceFee` now lists the destination transfer's existing reversals and adopts one tagged `metadata.bsFeeFor:<invoiceId>` as the idempotency source of truth. That tag survives both the marker-write failure and the idempotency-key TTL, so a retry re-records the marker with the already-reversed amount instead of reversing again — mirroring the per-charge fee collector's frozen-config guarantee. No API surface change.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix: collect the fixed/tier platform fee on a subscription's first invoice ([#52](https://github.com/kellykampen/better-stripe/issues/52)).

  `applyPerInvoiceFee` applies a fixed/tier `application_fee_amount` at `invoice.created`, which only works while the invoice is still a draft. Stripe finalizes a `charge_automatically` subscription's first invoice synchronously at creation (and Checkout subscription-mode pays it during checkout), so `invoice.created` fires with an already-`open` invoice — the update is silently rejected and the first cycle's platform fee was lost on every destination-charge subscription with a fixed/tier fee. Percent-only fees and renewal invoices (which get Stripe's ~1h draft window) were unaffected.

  Fixed with a new `applyFirstInvoiceFee` processor hooked at `invoice.paid`: it collects the missed fee via a partial reversal of the automatic destination transfer, sized from `amount_paid` — the same mechanism the per-charge fee collector's `applyPerChargeFee` uses for one-time charges. Skips any invoice whose fee the draft path already collected, so there's no double-collection. No public API change.

- [#21](https://github.com/kellykampen/better-stripe/pull/21) [`1f43345`](https://github.com/kellykampen/better-stripe/commit/1f433459ec6eb11d75982f1ed883cff9414d4e15) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix `createPrice` orphaning a Stripe price when the product is missing from the component DB.

  `createPrice` previously called `stripe.prices.create(...)` **before** verifying the product existed in the component DB, then threw `PRODUCT_NOT_FOUND` afterward — leaving an orphaned price in Stripe with no corresponding component record. The product lookup now runs **first**, so a missing/unsynced product throws before any Stripe write happens. No API change; behavior only differs on the error path.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix: collect deferred `per_charge` platform fees via transfer reversal ([#38](https://github.com/kellykampen/better-stripe/issues/38)).

  `bsFeeMode="per_charge"` (used when a one-time destination charge's final amount isn't known up front — discounts, `custom_unit_amount` prices, or a `sessionOverrides`-replaced `line_items`) had no webhook consumer, so the fixed/tiered platform fee was silently never collected on those charges.

  Fixed with a new `applyPerChargeFee` processor at `payment_intent.succeeded`: it collects the fee the same way Stripe itself settles application fees on destination charges — a partial reversal of the automatic destination transfer, sized by `computeFee` from the amount actually charged (`amount_received`). No public API change; charges that already pass `amount` up front (computing `application_fee_amount` at session creation) are unaffected.

- [#66](https://github.com/kellykampen/better-stripe/pull/66) [`a47d64d`](https://github.com/kellykampen/better-stripe/commit/a47d64d39ece42b4cc0d96508e9b87925c6bf8e9) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix `addRecipientConfiguration` not persisting `appliedConfigurations` to the component DB.

  `addRecipientConfiguration` applied the V2 recipient configuration on Stripe but never wrote the result back to the component `accounts` row, unlike `addCustomerConfiguration` which re-fetches and records `applied_configurations` after every update. Callers had to manually run `syncAllAccounts` afterward to reconcile the component DB, leaving it stale in between — anything reading `appliedConfigurations` off the component row (e.g. billing-view/UI gating) saw an out-of-date picture. `addRecipientConfiguration` now follows the same pattern: re-fetch the account after the Stripe update, read `applied_configurations`, recover the owning `userId` from the existing component record (failing closed with `ACCOUNT_NOT_FOUND` if the account isn't in the component DB yet), and `upsertAccount`. No public API change on the call side; the return shape now includes `appliedConfigurations` alongside `success`, matching `addCustomerConfiguration`.

- [#76](https://github.com/kellykampen/better-stripe/pull/76) [`c9f1489`](https://github.com/kellykampen/better-stripe/commit/c9f148948f2f5ea77f343c5fc1a78faffbb5ac1e) Thanks [@kellykampen](https://github.com/kellykampen)! - Fix three transfer-reversal money races via atomic reversal-slice claiming ([#61](https://github.com/kellykampen/better-stripe/issues/61)).

  - Dispute clawback (amount mode): a retry after partial success recomputed per-leg amounts from mutable ledger state — a same-params replay could double-record the ledger, or a shifted remainder could resend different params under an already-used Stripe idempotency key, causing a permanent event-retry loop.
  - Refund clawback (delta-to-target): two distinct refunds racing between the ledger read and the Stripe call could both compute the same reversal target from stale state, over-reversing a leg and under-recording the ledger.
  - `payment_intent.succeeded` redelivery could have `upsertPayment`'s blanket patch rewrite `feeCollectedAmount` back to the gross fee, bypassing the monotonic fee-refund guard.

  Fixed by claiming the exact reversal slice atomically, in a new component mutation, before any money moves — so a retry re-adopts the already-claimed slice instead of recomputing and re-reversing it. No public API change.

## 0.3.0

### Minor Changes

- [#16](https://github.com/kellykampen/better-stripe/pull/16) [`2fdbdf3`](https://github.com/kellykampen/better-stripe/commit/2fdbdf3ae2da75cb510d767e8e8787a5bab06d8b) Thanks [@kellykampen](https://github.com/kellykampen)! - Simplify webhook handler registration: replace the 18-export `triggersApi()` with a single `stripe.webhookHandlers()` returning a `{ syncWebhook, asyncWebhook }` pair, wired via `registerRoutes(..., { webhooks: internal.stripe })`.

  **Breaking (pre-1.0):** `triggersApi()` is removed. The `triggers` (sync, same-transaction) and `hooks` (async, after-commit) constructor shape is unchanged — only the wiring collapses from 18 named refs to 2. Migrate:

  ```ts
  // before
  export const { accountUpserted, /* …16 more… */ afterPayoutCompleted } =
    stripe.triggersApi();
  registerRoutes(http, components.betterStripe, {
    ...secrets,
    triggers: internal.stripe,
  });

  // after
  export const { syncWebhook, asyncWebhook } = stripe.webhookHandlers();
  registerRoutes(http, components.betterStripe, {
    ...secrets,
    webhooks: internal.stripe,
  });
  ```

  Also: `STRIPE_SECRET_KEY` is now declared (required) in the component's `convex.config.ts`, so Convex validates its presence at push time; the installing app wires it via `app.use(..., { env: { STRIPE_SECRET_KEY: app.env.STRIPE_SECRET_KEY } })`.

<!--
  This file is maintained by Changesets — do not hand-edit released sections.
  To record a change, run `pnpm changeset` and commit the generated file in
  `.changeset/`. New version sections are prepended above by `changeset version`
  (run automatically in the "Version Packages" PR). History below 0.3.0 was
  written by hand before Changesets was adopted.
-->

## 0.2.0 — 2026-06-11

### Breaking

- Trigger system is now wired into webhook processing. `triggersApi()` no longer returns `on*`/`after*` wrappers keyed by event; it returns 9 sync dispatchers (`accountUpserted`, `productUpserted`, `priceUpserted`, `subscriptionUpserted`, `subscriptionDeleted`, `checkoutSessionUpserted`, `invoiceUpserted`, `paymentUpserted`, `payoutUpserted`) plus 9 async hook wrappers (`afterAccountUpdated`, `afterCheckoutCompleted`, `afterSubscriptionUpdated`, `afterSubscriptionCanceled`, `afterTrialEnding`, `afterInvoicePaid`, `afterPaymentSucceeded`, `afterPaymentFailed`, `afterPayoutCompleted`). Each dispatcher performs the component upsert and the configured sync trigger in one transaction; `after*` hooks are scheduled via `ctx.scheduler` after the event is marked processed.
  - Migration: export all 18 names from a Convex module and pass it to `registerRoutes` via the new `triggers` config (`triggers: internal.stripe`, no cast needed). See the README Quick Start.
- `listPayouts` filter renamed `accountId` → `stripeAccountId`, with new optional `status` and `limit` filters.

### Added

- `getInvoice` / `getInvoiceByStripeId` client query methods, plus `getInvoiceByStripeId`, `getPaymentByStripeId`, and `getPayoutByStripeId` component queries.
- `createAccountSession` for Stripe Connect embedded account management (throws structured `ConvexError(BetterStripeError)` on failure).
- `customer.subscription.trial_will_end` webhook support (fires the `onTrialEnding` async hook); V1 event constant list grows to 20 events (32 total).
- Account-scoped listing: `listSubscriptions` now accepts `{ stripeAccountId?, status?, limit? }` and `listInvoices` accepts `stripeAccountId`; new `accountId` indexes on `checkoutSessions`, `invoices`, and `payments`.
- `TriggerApiRefs` type and `triggers` field on `RegisterRoutesConfig`.
- React: `countryPlaceholder` i18n prop on `AccountCreateCard`.
- Example app: trigger dispatchers wired into `registerRoutes`; billing portal session created via a component-backed action.
- Example app: automated E2E webhook test harness (`npm run e2e:webhooks`) — fires real Stripe-signed events via `stripe trigger`/`stripe listen` against the deployed endpoint and asserts the ledger plus a new `triggerLog` table that records every sync-trigger/async-hook invocation (sync triggers write in the same transaction as the dispatcher).

### Fixed

- V2 thin-event verification was broken under stripe-node v22: `webhooks.constructEventAsync` rejects thin payloads after verifying the signature, so every correctly signed `v2.core.*` event was returned a 400. `verifyV2Event` now uses `stripe.parseEventNotificationAsync`.
- Failed webhook ledger events are reprocessed on Stripe retry instead of deduplicating forever; sync-trigger failures roll back the component upsert and return 500 so Stripe retries.
- Async hooks now run after the upsert transaction commits, with the committed doc.
- React rules-of-hooks violations: `useQuery` is always called, using Convex's `"skip"` sentinel in 6 conditional read hooks.
- React: `AddCardForm` tracks real processing/error state; `BillingPortalLink` tracks async loading state.
- `clearAllTables` now also clears the `webhookEvents` ledger.
- `getTrialStatus` trial fields derived from shared subscription fields.

### Changed

- Component return validators fully typed — 30 `v.any()` return validators replaced across core, products, billing, connect, and webhooks; client status unions narrowed and `as any` casts dropped.
- Stripe API version pin upgraded to `2026-05-27.dahlia`; dependencies bumped (convex 1.41, stripe-js 9.8, react-router 7.17).

## 0.1.0

- Initial extraction from Dojo monorepo
- Stripe V2 Accounts API support
- Webhook handling (V1 snapshot + V2 thin events)
- Full CRUD for accounts, products, prices, subscriptions, checkout sessions, invoices, payments, payouts
