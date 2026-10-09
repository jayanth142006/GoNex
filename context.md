# CryptoNet Context

This document describes the actual behaviour of the current CryptoNet product as implemented in the project. It is written from a user/product perspective, not from a code or infrastructure perspective.

## 1. What is CryptoNet?

CryptoNet is a payment bridge between Indian UPI payments and crypto settlement on a blockchain. It lets a user create a payment request for a specific INR amount, deposit the matching crypto value into a smart contract, and then let another participant complete the payment in fiat through UPI. Once that payment is treated as complete by the system, the crypto side settles automatically to the resolver.

The problem it solves is a real-world friction point: many users in India want to use crypto, but everyday merchants and services still mostly accept Indian rupee payments through UPI. CryptoNet tries to connect those two worlds by letting a requester receive INR through a UPI flow while the settlement happens in crypto.

The main users are:

- Requesters: people who want to receive a payment in INR but are willing to settle it in crypto.
- Resolvers: people who can pay the INR side through UPI and then receive the crypto side as a reward.
- Wallet holders: anyone using MetaMask or a compatible wallet to interact with the blockchain.

The overall purpose is to let someone create a payment request in INR, have it fulfilled through a human UPI payment, and complete the settlement using crypto held in escrow.

UPI plays the fiat leg of the process. It is how the payment is made in India, using a UPI ID or QR code. The system uses a UPI ID / QR as the off-chain payment instruction.

Cryptocurrency plays the settlement leg. The requester deposits DAI and the app uses ETH for the fee side of the transaction. The resolver ultimately receives the crypto settlement.

The system exists because it tries to bridge two separate payment rails:

- the familiar UPI world for Indian merchants and users
- the blockchain world for crypto transfer and escrow

The product is fundamentally a trust-and-settlement mechanism: the requester puts funds in smart-contract escrow, the resolver pays the INR side, and the contract releases crypto once the flow is completed.

## 2. Core concept

The basic concept is simple:

1. A user creates a payment request for an INR amount.
2. The request includes the UPI details needed for someone else to pay in rupees.
3. Another user, the resolver, agrees to handle that UPI payment.
4. The resolver pays the request via UPI.
5. The resolver then submits a proof reference, which in this implementation is a 12-digit transaction number.
6. The smart contract verifies the basic format of that reference and then releases the crypto amount to the resolver.

The relationship is:

- User/requester: wants a payment in INR and is willing to pay in crypto.
- Payment request: holds the amount, the crypto deposit, and the UPI payment details.
- UPI payment: the INR side of the transaction; it is completed off-chain by a resolver.
- Resolver: pays the INR side and receives the crypto settlement.
- Crypto assets: DAI is the settlement token; ETH is used in the transaction fee path.
- Smart contract: holds the escrow, tracks state, and releases crypto after a valid payment flow.
- Payment settlement: the final step where the contract transfers the crypto to the resolver and marks the request complete.

This is not an instant bank-to-blockchain settlement. It is a human-mediated flow: the resolver pays the UPI side, then the system releases the crypto side.

## 3. Complete user flow

The end-to-end payment journey is as follows.

1. A user wants to make or receive a payment.
   - If they are the requester, they want to accept INR via UPI and receive crypto settlement.
   - If they are the resolver, they want to take on a payment request and complete the UPI leg in exchange for crypto.

2. A payment request is created.
   - The requester enters the INR amount.
   - The app calculates the corresponding DAI amount and the ETH fee path.
   - The requester uses a wallet to create the request on-chain.
   - The request is assigned a contract request ID.

3. Relevant payment information is provided.
   - The requester supplies the UPI ID, payee name, note, and amount.
   - These details are stored with the request so a resolver can pay the intended UPI destination.
   - This payment data is treated as sensitive and is not exposed as a public blockchain record.

4. UPI payment takes place.
   - A resolver sees the request in the available list.
   - They commit to the request, reserving it for a short period.
   - The resolver then pays the INR amount to the UPI destination represented by the request.
   - The resolver is expected to use the QR or UPI deep link generated from the request details.

5. Resolver verifies or handles the relevant payment information.
   - After making the UPI payment, the resolver enters the 12-digit UPI transaction reference number into the app.
   - This is the only reference the current on-chain logic checks.
   - The app does not verify the actual bank status of the UPI payment in real time.

6. Crypto-side settlement occurs.
   - Once the resolver submits the transaction reference and the request is still valid, the smart contract releases the escrowed crypto.
   - The DAI deposit is sent to the resolver.
   - The extra ETH payer fee is also sent to the resolver.

7. Smart contract state changes.
   - The request moves from pending or committed to fulfilled.
   - The contract records the transaction reference and marks the request as completed.

8. Payment is completed.
   - The requester has had the payment satisfied via UPI.
   - The resolver receives the crypto settlement.
   - The transaction is considered completed from the system’s perspective.

## 4. Payment request lifecycle

The actual states in the application are:

PENDING
  ↓
COMMITTED
  ↓
FULFILLED

Other valid terminal/alternate states:

PENDING
  ↓
CANCELLED

PENDING
  ↓
EXPIRED

COMMITTED
  ↓
CANCELLED

COMMITTED
  ↓
EXPIRED

### PENDING
What it means:
- The payment request exists and is open for someone to commit to.
- It has not yet been taken by a resolver.

Before this state:
- The requester has created the request and deposited DAI plus the fee path.

What happens next:
- A resolver can commit to it.
- The request can also be cancelled by the requester before it is fulfilled.
- It expires after 24 hours if still unresolved.

What the user should understand:
- This is the open request state.
- A pending request has not been accepted by a resolver yet.

### COMMITTED
What it means:
- A resolver has reserved the request and is now responsible for the UPI payment leg.
- A time window begins.

Before this state:
- A resolver selected the request and committed it on-chain.

What happens next:
- The resolver pays the UPI amount.
- The resolver enters the 12-digit UPI number.
- If the resolver does not complete the payment in time, the commitment can time out and the request becomes available again.

What the user should understand:
- This state means the request is being actively processed.
- It is not settled yet.
- The resolver must finish the payment before the commitment window closes.

### FULFILLED
What it means:
- The payment has been completed from the system’s perspective.
- The smart contract has released the crypto settlement.

Before this state:
- The resolver paid via UPI and submitted the transaction reference.

What happens next:
- The request stays in the completed record set.
- It is no longer available for other users.

What the user should understand:
- This is the completion state.
- The crypto side has been settled to the resolver.

### CANCELLED
What it means:
- The requester ended the request before it was fulfilled.

Before this state:
- The request was pending or committed.

What happens next:
- The requester receives the DAI refund and the payer fee refund.
- The request is closed.

What the user should understand:
- This is a user-initiated stop.
- The responder does not receive the settlement in this path.

### EXPIRED
What it means:
- The request has reached its time limit and is no longer valid.

Before this state:
- The request stayed open too long or the commitment window passed without completion.

What happens next:
- The requester receives the refunded DAI and payer fee.
- The request cannot be paid later.

What the user should understand:
- Expired means the offer is no longer valid.
- This is not a successful settlement.

## 5. User roles

The actual user roles in the product are straightforward.

### Requester
Who they are:
- A person who wants to receive an INR payment and settle it using crypto.

What they do:
- Create a payment request.
- Provide the UPI destination details.
- Deposit the required DAI amount.
- Fund the fee path in ETH.

What they can initiate:
- Create a new request.
- Cancel a request while it is still open.

What they are responsible for:
- Providing correct UPI information.
- Using the correct wallet and network.
- Understanding that the payment flow depends on a resolver paying the UPI side.

How they interact with the process:
- They create the request and then wait for resolution.
- They do not directly settle the INR payment themselves in the normal flow.

### Resolver
Who they are:
- A participant who pays the UPI portion and then receives the crypto settlement.

What they do:
- Browse available requests.
- Commit to a request.
- Pay the UPI amount to the destination.
- Submit the UPI transaction reference.
- Receive the crypto settlement after the contract allows it.

What they can initiate:
- Commit to a payment.
- Fulfill a committed payment.
- View the UPI QR / deep link associated with the request.

What they are responsible for:
- Completing the actual INR payment correctly.
- Providing the correct 12-digit transaction reference.
- Ensuring they are on the correct wallet/network.

How they interact with the process:
- They act as the bridge between UPI and crypto.
- They are the ones who pay the fiat side and receive the crypto side.

### Platform fee recipient / contract owner
Who they are:
- The wallet that owns the smart contract deployment.

What they do:
- Receive the flat platform fee when a new request is created.

What they can initiate:
- Not a normal user role in app flows.

What they are responsible for:
- Receiving the fee from new requests.

How they interact with the process:
- They are not a regular participant in the request lifecycle; they only receive the fixed fee created during request setup.

## 6. UPI flow

The UPI part is the INR payment leg.

### What information the user provides
The request includes:

- UPI ID
- payee name
- payment note
- INR amount
- sometimes a QR-generated destination

This information is used to generate a UPI deep link or QR code that a resolver can use to pay the merchant in rupees.

### What the UPI QR/payment information represents
It represents the destination that should receive the INR payment. In other words, it is the payer’s destination for the fiat side of the payment, not the blockchain wallet address.

It is not a blockchain wallet address and it is not a token address.

### What happens after the UPI payment
After the resolver completes the UPI payment, the resolver enters the 12-digit transaction number into the system.

The app then asks the smart contract to fulfill the request using that transaction reference.

### What information is used to associate the UPI payment with the CryptoNet request
The system links the blockchain request and the off-chain payment details using a request ID and stored payment metadata. The contract stores the on-chain request ID. The UPI data is kept separately so that the sensitive UPI information is not exposed on-chain.

### What the resolver does
The resolver is expected to:

- commit to the payment
- see the UPI QR/deep link
- pay the INR amount in the flow
- then enter the UPI transaction number

### What CryptoNet can and cannot verify
CryptoNet can verify:

- the request still exists
- the request is committed to the correct payer
- the UPI transaction reference is a 12-digit numeric value

CryptoNet cannot reliably verify:

- whether a real bank payment actually reached the destination
- whether the UPI transaction was genuinely successful
- whether the payment belongs to the same payer without a banking/oracle integration

This is critical: the implementation currently does a basic format check of the transaction number, not a real payment-gateway verification.

## 7. Crypto flow

The crypto side is the settlement path.

### Which crypto assets are involved
The current implementation uses:

- DAI as the main settlement token
- ETH as the network fee and extra payer-side fee path

DAI is used because it is a stablecoin and works as the crypto equivalent for the requested value. ETH is needed because blockchain transactions require gas and because the system tracks a payer fee in ETH.

### Why they are involved
The requester is effectively locking up the amount in DAI, while the resolver is compensated for taking the UPI path. ETH is used for gas and the additional fee logic.

### How the crypto side relates to the UPI side
The UPI side is the cash-like fiat payment that the resolver handles. The crypto side is the compensation and settlement that happens after the resolver completes the UPI leg.

The two sides are linked by the payment request and the commitment/fulfillment process.

### What happens during settlement
When the request is fulfilled:

- the contract sends the DAI deposit to the resolver
- the payer fee in ETH is also sent to the resolver
- the request is marked fulfilled

### What the smart contract does conceptually
The smart contract is the escrow and state tracker. It holds the request, tracks who is committing, enforces the time windows, and releases funds when the required completion flow is met.

Important: it is not a bank payment verifier. It is a state machine plus escrow.

### What the user ultimately receives
The resolver ultimately receives the crypto settlement in DAI and the associated ETH payer fee. The requester receives the UPI payment in rupees from the resolver and is no longer holding the escrowed crypto after settlement.

## 8. Wallet / MetaMask flow

MetaMask is required for the blockchain side of the app.

### When the wallet is required
The wallet is required when:

- a user logs in with wallet identity
- a requester creates a payment request
- a resolver commits to a request
- a resolver fulfills a payment
- a user wants to see wallet balances and network status

### Why it is required
The app uses the wallet to interact with the smart contract and sign wallet identity. Without a connected wallet, the user cannot create, commit, or fulfill requests on-chain.

### What the user is expected to approve/sign
The app asks the user to:

- connect the wallet
- approve access to the account
- sign a message to authenticate the wallet
- approve the blockchain transaction when creating or fulfilling a request

In the current implementation, the wallet sign-in message is just a wallet ownership check; it is not a server-side identity verification.

### What happens after the transaction
After the transaction is submitted:

- the user waits for confirmation on the blockchain
- the request is updated once the transaction is mined
- the UI refreshes to reflect the new state

### Common wallet-related problems
Realistic issues include:

- MetaMask not installed
- user rejects the wallet connection
- user rejects the transaction
- wrong network selected
- insufficient ETH for gas
- insufficient DAI for the request deposit
- transaction fails on-chain

## 9. Fees

The product does include fees, and the current implementation has a specific fee structure.

- A flat platform fee is charged when a request is created.
- The contract sets this fee at 10,000 wei in ETH.
- This fee is sent immediately to the contract owner at request creation.
- The requester also has a payer reward / payer fee path in ETH. This amount is part of the crypto side and is paid to the resolver on completion.
- The requester must fund the DAI deposit plus the ETH fee path.

In practical terms:

- The requester sends DAI to the contract for the settlement value.
- The requester also sends ETH for fees.
- The resolver receives the DAI plus the payer fee when the request is fulfilled.
- The platform fee is not returned in the normal cancellation or expiry path.

If the request is cancelled or expires, the requester gets the DAI and payer fee back, but the platform fee is not refunded.

## 10. Expiry / timing

The implementation has explicit timing rules.

- Request expiry: 24 hours after creation
- Commitment timeout: 5 minutes after a resolver commits

This means:

- a pending request remains open until it is fulfilled, cancelled, or expires
- a committed request must be completed within the 5-minute commitment window
- if the resolver does not complete the payment in time, another resolver can commit later
- requests that are past their expiry are no longer valid

From a user perspective, this is a short window for the resolver to complete the UPI leg and submit the reference. If the resolver misses it, the request goes back into circulation.

## 11. Common errors / failure cases

These are the realistic failure cases users may see in CryptoNet.

### Wallet not connected
What it means:
- The user cannot create or fulfill requests without a live wallet connection.

What to do:
- Connect MetaMask and approve access.

### Wrong network
What it means:
- The wallet is on an unsupported or incorrect chain.

What to do:
- Switch to a supported network such as Base, Base Sepolia, or the Hardhat local development chain in the configured environment.

### Insufficient balance
What it means:
- The user lacks enough ETH for gas, or enough DAI for the deposit.

What to do:
- Add the required funds before creating or fulfilling a request.

### Transaction rejected
What it means:
- The user cancelled the wallet transaction or the wallet blocked it.

What to do:
- Retry and check the wallet permission prompts.

### Request expired
What it means:
- The request moved past the 24-hour limit.

What to do:
- Create a new request or find an active one.

### Invalid payment information
What it means:
- The UPI data is missing, malformed, or not usable.

What to do:
- Recheck the UPI ID, amount, payee name, and note.

### Payment still pending
What it means:
- The resolver has committed but has not yet completed the UPI leg or the transaction reference step.

What to do:
- Check the pending requests page and finish the UPI payment and submission before the commitment window closes.

### Resolver-related issue
What it means:
- The committed resolver did not finish within the allowed commitment window.

What to do:
- Another participant can commit after the timeout window expires.

### Blockchain transaction failure
What it means:
- The smart contract call failed or the transaction was not mined.

What to do:
- Check wallet status, network, and balances, and retry only after confirming the issue is resolved.

## 12. Security / safety

Users should be aware of the following:

- Never share wallet private keys.
- Never share seed phrases or recovery phrases.
- Verify the wallet address before approving a transaction.
- Verify the network before sending funds.
- Verify the UPI detail and transaction reference before assuming the flow is complete.
- Understand that blockchain transactions are generally irreversible once confirmed.
- Treat the UPI payment number as a user-submitted reference, not as proof of a real bank transfer unless external verification exists.

CryptoNet is designed around wallet ownership and transaction signing, not bank-side guarantees.

## 13. Limitations

This is extremely important: CryptoNet does not guarantee full payment verification beyond the basic on-chain state machine.

The current system does not provide a real bank-level UPI status check. It does not connect to a regulated payment gateway or bank API to confirm that the UPI payment reached the destination. The app only validates that the submitted transaction reference is a 12-digit numeric string.

This means:

- the system does not truly prove that the UPI payment succeeded
- it assumes the resolver honestly enters the correct payment reference
- it assumes the requester and resolver are acting in good faith
- there is no built-in payment dispute, chargeback, or real banking reconciliation system in the current product

Additional assumptions in the current implementation:

- the off-chain payment metadata is stored separately and associated with the request ID
- users are responsible for confirming the correct wallet, network, and payment details
- the system treats the UPI reference as evidence of completion without confirming it against a bank or payment-network source

There is no formal guarantee of real-world settlement finality beyond the contract’s state changes.

## 14. Frequently Asked Questions

### What is CryptoNet?
CryptoNet is a product that connects UPI payments with crypto settlement. It lets one side create a payment request and the other side complete the UPI payment while the crypto side is settled through a smart contract.

### How does CryptoNet work?
A requester creates a payment request, sets the UPI destination, and deposits the required crypto. A resolver commits to the request, pays the UPI amount, submits the payment reference, and then receives the crypto settlement.

### What is a payment request?
A payment request is a request to receive an INR amount through UPI while using crypto as the settlement logic.

### What is the role of UPI?
UPI is the fiat payment rail used for the INR side of the transaction. It is how the resolver pays the request in rupees.

### What is the role of the resolver?
The resolver is the person who handles the UPI payment and then receives the pooled crypto settlement after fulfilling the request.

### What is DAI?
DAI is the stablecoin used on the crypto side of the flow. It is the token that the contract holds and later transfers to the resolver.

### Why do I need ETH?
ETH is needed for blockchain gas and for the fee side of the payment logic. The contract also includes a platform fee path in ETH.

### Why do I need a wallet?
The wallet is required to create requests, commit to them, approve the transactions, and receive the crypto settlement on-chain.

### What does pending mean?
Pending means the request is open and has not been accepted by a resolver yet.

### What happens when a request expires?
The request is no longer valid and the requester can receive a refund of the DAI and payer fee path. The platform fee is not refunded.

### What happens if my transaction fails?
The wallet or blockchain network will reject or fail the transaction. The user must fix the cause of the failure, such as wrong network, insufficient funds, or rejected approval.

### Is my UPI payment automatically verified?
Not in the current implementation. The system expects a resolver to enter a 12-digit transaction number, but it does not perform real bank or payment-gateway verification.

### What should I do if MetaMask rejects my transaction?
Check that the wallet is connected, the correct network is selected, you have enough ETH for gas, and you are approving the correct transaction. If the issue continues, retry after checking wallet permissions and balances.

### Is the system risk-free?
No. The current product relies on user honesty, wallet approval, and basic transaction-format checks. It does not provide full bank-level validation or dispute guarantees.

### What is UNKNOWN / NOT SPECIFIED?
Several real-world guarantees are not defined in the current implementation, including formal bank verification, refund handling outside the contract flow, compliance processes, dispute resolution, and any payment-gateway integration beyond the basic 12-digit number check.

## Summary

CryptoNet is a user-facing bridge between Indian UPI payments and blockchain-based crypto settlement. Requesters create INR payment requests, resolvers complete the UPI side, and the smart contract releases the crypto side once the request is fulfilled. The system is practical and simple, but it has important limits: it does not verify real UPI success against a bank or payment gateway, and it relies on the transaction reference as a basic check rather than a real payment confirmation. Users should treat the product as a smart-contract escrow and UPI mediation flow, not as a fully bank-verified payment system.
