# Renewal context reads and attachment request preparation

`BetterStripe.readRenewalPriceReplacementContext` reads the original provider
subscription, authorized target price and correlated billing Customer. Hosts
must authorize the caller and exact original selectors before invoking it on
the server. This method does not create or update provider resources, persist
operation ownership or establish financial preservation.

```ts
const context = await betterStripe.readRenewalPriceReplacementContext(ctx, {
  expected,
});
const prepared = prepareRenewalPriceReplacement({
  subscription: context.subscription,
  targetPrice: context.targetPrice,
  billingCustomer: context.billingCustomer,
  expected,
  key: logicalKey,
});
const attachRequest = prepareRenewalScheduleAttachment({
  prepared,
  apiVersion: context.apiVersion,
  attachKey,
  firstDispatchedAt,
});
```

The two preparation functions are pure exports. The host supplies and durably
retains the logical key, explicit attachment key, original first-dispatch time
and complete records under immutable authorization. An explicitly chosen attach
key may equal the logical key; no key is silently reused, derived or generated.
A future configure key must differ from the attachment key.

Preparation validates the original Subscription, target Price and optional
billing Customer, then retains their complete captured JSON bodies. Eligible
unknown fields, including own JSON keys such as `__proto__`, remain in the
snapshot and binding; validation does not replace the retained body with a
selected-field view. Unsupported fields in strict schemas still reject.

Older snapshots that already omitted a field cannot recover it or establish
retroactive full-record provenance. Reconstructing a changed full record does
not migrate its old binding or authorize a retry.

## Internal ownership and transport groundwork

The legacy `renewalAttach/internal` facades keep one dormant original Owner
identity and adapt the stock Stripe client's inherited `rawRequest` method without
changing its receiver, arguments, result or thrown value. The owner checks the
same original wall and monotonic time bounds and closes permanently on expiry,
regression or retirement. These modules do not read a clock at import time.

The internal initial-attachment and explicit-recovery actors compose these
guards with the raw reader and event continuations. Each captured invocation is
single-use. Before acquisition, an actor checks the exact Source operation,
read-plan and delegate identities and the complete locally rebuilt attachment
request. Retained and fresh coverage require literal `true` from their selected
entry predicates.

An admitted invocation has a distinct transport pair with at most 43 GETs and
one creation POST. Dispatch, safe response and receipt events each require
send completion and a matching acknowledgement. Explicit unknown recovery
retains the original request, key, first-dispatch time and owner, while using a
new transport pair. An observed Schedule remains unowned evidence; matching its
shape never substitutes for the acknowledged creation response. Complete
acknowledged results pass bounded JSON admission before the final owner check.

The compiled registries remain empty, and the original Source and stock client
bindings remain unbound. Normal actor invocation refuses before Source access;
there is no package-root export or qualified operational entry. These internal
Node-only mechanics establish no provider custody or native qualification and
expose no caller-supplied clock, client or qualification API. The public
preparation and receipt constructors are unchanged.

The maintained SDK constructor records an inert identity for its private renewal
bridge. A fixed internal journal entry can bind an actual registered Action and
an operation ID to that SDK instance and its component. This binding supports
unsigned journal DATA: it does not select a Stripe client, create a clock or
Owner, or qualify provider execution. The separate operational entry continues
to refuse while execution profiles are unqualified. Normal construction and
context reads remain available; no public schedule writer is added.

Only the class-bound journal facade can retain a process-local identity for its
original fulfilled `acquired` reservation call. Existing or conflicting replies,
queries and generic DATA facades create no such identity. Consuming a valid call
spends it before checking the expected class journal, so a wrong journal or
failed check cannot make it reusable. The returned reservation and local tag
remain unsigned bookkeeping DATA; copies cannot create or revive a call, a live
Owner or provider authority. A handle lost across an Action return, restart or
reply loss is not reconstructed from stored records or retried with a new key.

The private Node invocation core can consume that original call to construct an
isolated Owner. It checks the SDK's pre-reservation own-data configuration
descriptors and values before calling its constructor-captured selector. Extra
client arguments, changed descriptors, copied handles and existing reservation
results cannot select a client or sample a clock. This construction step grants
no operational profile or public scheduling capability.

Each lineage retains one selected stock client, its original raw-request method
and receiver, and one canonical Owner. The core samples monotonic time immediately
before and after its initial wall-clock sample. It uses the lower monotonic sample
with the existing six-field basis formula and the original absolute wall cutoffs.
The upper capture sample must remain below both projected cutoffs; elapsed
capture time does not create a new budget. Exact u64 projection overflow refuses.
Both clocks must remain monotone and below their work cutoffs, independently of
paid-period and replay-age checks. These are
local Node clock assumptions, not provider or real-time execution qualification.

The core awaits the actual component basis-binding result before returning.
Pending continuations retain their own Owner; retiring one lineage cannot retire
another. Deadline notification uses Node timer chunks capped at 2,147,483,647
milliseconds and bounded by the earlier remaining wall or monotonic work cutoff.
Each callback rechecks both clocks and the original policy before rearming. The
later final deadline is not a timer span limit. Event-loop suspension can delay
callbacks. Every continuation therefore checks both clocks before
returning a value. Retirement is irreversible and never extends either original
cutoff. Legacy actors retain their separate dormant identity and behavior.

The private initial core can capture one attach-stage C10 compiler for its own
lineage. This compiler takes the original raw source and actual acquired
reservation from that lineage, and binds its sender to the same captured class
journal. Its dispatch, response and receipt events use the existing compiler
checks and actual component append transactions. C10 acknowledgement follows
the matching committed append and checks the original Owner again. Callers
cannot replace the source, sender, Owner or append timeout through this capture.
Retiring one invocation rejects its pending channel without retiring another
invocation's channel or removing already committed DATA. Stored events and C10
append acknowledgements do not establish provider custody or a returned public
operation acknowledgement. Legacy stage-channel facades retain their existing
lazy Owner and behavior.

The core's private material classifiers also retain the original journal source
and canonical Owner. Retained classification accepts no replacement source.
Fresh classification accepts read DATA and its observed timestamp, then uses the
existing raw Coupon join checks and actual C1/C2 reconstruction against the
original source. Both paths keep the existing DATA-consistency-only result and
bounded snapshots. They do not qualify acquisition or provider custody. Pending
reconstruction is owned by that invocation; retirement rejects its continuation
without closing another invocation's classifier. Legacy classifier exports keep
their lazy Owner and existing refusal behavior.

The private initial actor now uses those classifiers, the canonical transport and
one acquisition reader for its lineage. Its operation retains one private origin
association and a single-use source slot. The transport captures the selected
SDK's original raw-request method and receiver, and receives the actual SDK
promise. Its fixed read plan permits the original subscription, target price,
billing customer and at most 40 original Coupon reads. It permits one attachment
POST. Callers cannot supply a replacement client, source, plan, Owner or journal
sink through the invocation core.

The actor retains the complete captured C3 receipt in the component journal at
sequence 2 before appending receipt event 3 or returning an acknowledgement.
Receipt retention alone is DATA. If the Owner retires while a committed retention
reply is pending, that DATA remains, but the actor refuses its acknowledgement.
Another invocation keeps its own client, Owner, journal and continuation.

Production Source class arrays remain empty. Empty admission returns before
constructing an Owner, loading Source data, invoking a client method or sampling
a clock, including when the
private actor is captured from a lineage that has no Owner yet. Tests admit
synthetic profiles in ordinary Node and Convex-test with controlled HTTP. They
do not qualify native execution or provider custody. Public scheduling, native
profile qualification, cross-process recovery and later operation stages remain
separate work.

The private core also captures one single-use explicit recovery actor. It keeps
actual initial attempt custody beside the initial actor, including its original
selected entry and predicates, reconstructed request and safely captured SDK
response when available. A stored or copied journal record cannot create this
custody. Recovery consumes its reservation before awaiting construction and
uses the same live Owner and original absolute deadlines.

A settled unknown POST without a safe response can use one explicitly invoked
same-request, same-key replay. It requires the committed dispatch event at head
1, no known acknowledgement and no pending journal writes. The new transport
pair retains the original selected SDK and bounded read plan. Complete fresh
reads must preserve the original residual subscription, target, customer and
Coupon material. The observed schedule association may remain null or become a
validated non-null reference. That pre-POST observation remains unowned DATA;
it never substitutes for the original creation acknowledgement. Recovery checks
the complete journal frontier again after dispatch acknowledgement and before
its POST. This read fence cannot atomically lock journal state and a provider
request; another authorized writer may race the final read-to-call interval.
Immutable conflicting history still refuses acknowledgement. The legacy
recovery facade retains its existing association rules.

When the original live invocation already holds a safe response, recovery
resumes acknowledgement without another provider read or POST. It rebuilds C3
from that response and the original request, idempotently completes matching C10
events and receipt retention, and checks the original Owner before returning the
fully admitted receipt. Existing event 2 or 3 must match complete immutable
history. Conflicting DATA refuses.

Each initial or recovery channel captures its own original-journal sender and
keeps that sender's irreversible stop latch. Journal work tracking follows all
actual send and retention promises for the lineage. A C10
channel timeout can close its caller while the underlying mutation remains
pending and may later commit. Recovery refuses while that work is pending. It
also refuses an unattempted operation, a returned acknowledgement, changed
entry predicates, missing class relation or a retired Owner. Retiring one
invocation cannot retire another SDK root or return its receipt. These are
ordinary Node and Convex-test mechanics with controlled HTTP, not native or
provider qualification. Cross-process recovery cannot revive this Owner or
reconstruct actual live response custody from stored DATA.

The core's private `attachAcknowledgement()` reader retains the exact admitted
output and receipt identities from one successful initial attachment, explicit
replay or no-POST acknowledgement resumption. Each completion pipeline records
its own return privately. The reader accepts no replacement receipt or context,
checks the original Owner and entry predicates on every successful read, and
returns one canonical process-local view with `operationalAuthority: false`.
Serializing that view discards its process-local custody identity.

Committed receipt DATA and even a complete receipt3 event can exist while the
actual pipeline is still awaiting a journal reply. The reader refuses until the
pipeline completes its successful internal return. An absent completion is not
cached and does not construct an Owner, sample clocks or allocate a timer. A
later successful read uses the existing original Owner and budget. Retirement,
changed predicates, removed class eligibility, copied DATA or unknown lineage
identities refuse. The same checks apply to cached views, and separate SDK roots
retain distinct output and receipt identities.

This reader supplies private configure admission with the actual attachment
receipt. Admission uses a separately authorized stage operation and request/key.
Configure execution still requires its channels, transport, actors and complete
journal integration. The internal return record
does not establish delivery to a disconnected caller, qualify a provider profile
or create a public scheduling entrypoint.

## Private configure admission

The private initial invocation core accepts `admitConfigure(call, journal)` only
with the original winning child reservation call and its actual class-bound
journal. It spends that call before checking arity or parent custody. The parent
comes from the core's closure; callers cannot replace its Owner, receipt, ACK,
client, selector, clocks or basis. A copied admission view cannot reconstruct the
private identity.

Admission requires the actual returned attachment ACK from initial completion,
replay or no-POST resumption. A published receipt whose reply is still pending is
insufficient. The parent and child journals must share the actual checked SDK
root, root cell and component. Each retains its own checked Action receiver and
RPC pointers; different genuine Action contexts are supported.

The child retains the exact parent Owner, selected client, origin association,
clock functions and original basis. Admission performs no new selection, Owner
construction or origin capture. Normal Owner checks still sample its original
clocks. Complete C3/C6/C7 source, parent history and retained acknowledgement DATA
must agree, including typed dispatch/response contents before event hashing.
Every used reservation, load, history, event, acknowledgement and binding reply
receives complete bounded runtime DATA checks against the current source
contract. Generated attachment-only declarations and reference identities stay
unchanged; these checks do not establish genuine generation or deployed
compatibility.

The actual child basis transaction must commit and return its complete matching
descriptor. Reads after binding require the original basis, head zero and no
known child ACK. The no-ACK read precedes the final head read; no later journal
await precedes readiness. This is a read fence, with no atomic lock against
subsequent journal changes. Future execution must check its frontier again.
Owner retirement rejects a pending admission even if its basis mutation has
committed; retained DATA and failed or lost replies cannot remint the consumed
call.

The result is an opaque private view containing `owner`, `basisJSON` and
`operationalAuthority: false`. The separate private C10 factory below can use
that identity. Cross-process configure recovery and public scheduling
remain required, as do genuine generation and operational qualification.
Production Source profile arrays remain empty.

## Private configure C10 channel

`createAdmittedConfigureEventCompiler(token)` accepts only the actual admitted
child identity. It captures one configure channel, including when capture fails;
callers cannot replace its source, sender, Owner or options. Copied views and
proxy identities cannot create another channel. The retained raw C6 configuration
supplies its source. The compiler reconstructs C7 dispatch and complete C9 receipt
DATA and compares each event before appending sequences 1 through 3 to the child
attempt. The parent attachment history remains separate.

The channel derives the canonical Owner from the original parent token. A fixed
synchronous child guard adds binding and custody checks at every channel gate,
including after hashing and around append/ACK handling and awaits. The guard
must return undefined; asynchronous or other non-void results refuse. It cannot
replace the Owner checks or retirement subscription. The guarded parent kernel
stays independent of configure lineage code, preserving the existing legacy
compiler and avoiding an import cycle.

The sender receives the exact original reservation object from the actual child
CAS and uses its original class-bound journal. A captured DATA copy is
insufficient. The actual component append must commit and return its matching
complete reply before C10 acknowledgement. Per-child work tracking follows the
actual append RPC promise independently of a channel timeout. A timed-out channel
can remain closed while a committed mutation reply is still pending. Late replies
cannot reopen it. Separate child and SDK-root channels retain their own sequence,
work and retirement state.

C10 append acknowledgement establishes DATA consistency only. Dispatch intent,
a committed response or receipt event, and a retained C9 do not establish provider
custody, returned configure ACK custody, pending/effective replacement or fresh
dispatch permission. Receipt retention remains a separate operation; a future
configure completion pipeline must retain the complete C9 before publishing
receipt event 3 and returning its actual acknowledgement. Execution requires its
own frontier checks. This channel factory supplies no provider transport and
activates no operational Source profile.

## Private admitted configure preflight

`captureAdmittedConfigurePreflight(token)` captures one readonly actor for the
actual admitted child. Capture and invocation are each spent once, including
failed calls and invalid extra arguments. The factory requires a unique compiled
preflight entry linked to the actual returned parent ACK entry and retains its
predicate identity. Production profile arrays remain empty, so this private path
still refuses without a qualified Source profile.

The actor uses the original parent Owner, SDK client, stock delegate promise and
class-bound child journal. It never loads the legacy singleton Owner or transport
source. The fixed plan reads the subscription with its existing expansions,
price, customer, original coupons in order and attached schedule last. Its 4–44
requests are GETs with explicit undefined bodies, API version
`2026-09-30.endive` and zero network retries. No caller can substitute a plan,
transport, source, clock, predicate or output.

The actor reconstructs retained C6 and C3 DATA, compares complete current reads,
reprojects the immutable C7 request and checks the compiled preflight predicate.
Observation time comes from the original Owner. Reconstruction preserves the
original first-dispatch time, key and deadlines. Complete operation, basis,
head-zero and ACK-null journal checks fence acquisition and output release.
ACK-null precedes the final head read. These bounded reads do not lock the journal
against a later concurrent write.

Successful completion privately retains the actual output identity, parent ACK
view and compiled entry pointers. Pending reads, copied output or copied tokens
cannot register completion. Owner retirement and observed custody changes close
the actor. The legacy preflight functions retain their original Owner checks
around shared DATA kernels. This readonly consistency result grants no configure
POST permission, returned configure ACK custody or public scheduling support.

## Private admitted configure write

`captureAdmittedConfigureWrite(token)` captures one initial write actor from the
actual completed preflight view. It retains the actual parent ACK, original
profile entry and preflight predicate pointers. A unique compiled write entry
must link to that original entry, and its predicate identity remains fixed.
Copied tokens, output DATA, pending preflight and replacement arguments cannot
supply custody. Production profile arrays remain empty.

The write transport preserves the legacy POST latch and quarantine kernel while
using the admitted child's original parent Owner and stock SDK delegate. It
performs its own fixed fresh GET sequence. The separate readonly preflight output
cannot mark this pair's read generation complete. Current reads and a fresh C6
reconstruction must still match the retained request exactly, including its key,
first-dispatch time, path, payload and API version.

Before dispatch intent, the actor checks the complete head-zero frontier. It
awaits the actual committed dispatch event 1 and C10 ACK, then checks full stored
event DATA, basis, absent acknowledgement, idle journal work and exact head one
before POST. Each invocation permits at most one POST, with the retained key and
zero retries. These checks are bounded read fences, not an atomic writer lock.
The transport marks uncertainty before calling the stock delegate. Synchronous
throws or non-Promise results cannot establish a proven provider rejection.

Fulfillment enters quarantine before response inspection or Owner checks. Only
safe captured response DATA can publish event 2. After actual C9 construction,
the actor records the receipt as known, durably retains its complete canonical
JSON at head two, validates the complete retention reply and reads it back.
Retention precedes whole-output admission and receipt event 3. Output refusal,
pending or rejected persistence replies, or failed event-3 publication cannot
permit another POST or establish a returned ACK. A private live attempt view
retains immutable actual C9/input DATA and POST disposition independently of the
returned ACK view. Copied tokens cannot read it, and the view grants no replay
or dispatch permission.

`readAdmittedConfigureAcknowledgement(token)` returns custody only after receipt
event 3 commits, its actual C10 ACK returns and the final complete history and
retention fence passes. The view retains the exact returned output and its
receipt/raw-receipt identities. A final guard precedes quarantine discard with
no intervening callback or Owner sample. Late fulfillment after retirement stays
unknown and cannot publish ACK custody. This initial-write actor never replays itself. Separate recovery remains explicit;
public scheduling and pending/effective acceptance remain outstanding.

## Private same-live-Owner configure recovery

`captureAdmittedConfigureRecovery(token)` synchronously reserves one recovery
from the actual original child attempt before its first await. The original
invocation must have started and settled, with idle journal work and no returned
ACK. The attempt retains its actual qualified pair, original fresh evidence,
preflight/profile pointers, immutable C7 and any owned safe response/C9/retention
reply. A disposition marker, copied token or journal DATA cannot supply that
custody. The original Owner, SDK client, method, basis and deadlines remain fixed.
Production Source profile arrays remain empty.

`NOT_STARTED`, `PENDING`, unsettled invocations and pending journal RPCs refuse.
A committed row does not establish that its actual RPC reply returned. Recovery
also refuses `FULFILLED_SAFE` without the actual saved response or C9. The write
producer saves that safe response before awaiting response-event publication;
a failed response append therefore cannot turn an owned response into permission
for another POST.

Unknown replay requires no owned response/C9, exact dispatch-only history and no
known acknowledgement. A distinct replay transport performs its own fixed fresh
GET generation. Complete raw baseline equality, fresh C6 reconstruction and the
captured write predicate must preserve the original C7, key and first-dispatch
time. Retention requires `0 <= now - originalFirstDispatch < 86400` before
acquisition and again immediately before POST. The original Owner must still be
live; this scalar rule never revives it. The actor re-ACKs the identical dispatch
DATA and repeats the full head-one/ACK-null/idle fence before its single replay
POST, with zero retries. Baseline drift or an already-applied state never becomes
a newly projected request.

Owned safe-response or C9 completion performs no provider GET or POST. It checks
the complete existing journal prefix against that actual custody, uses a distinct
original-journal sender, and re-ACKs or completes matching dispatch/response DATA.
A stopped original sender cannot be reopened. The actor constructs missing C9
from the owned response, retains complete canonical C9 and validates retention
reply/readback before whole-output admission or receipt event three. Matching
head-three DATA can be re-ACKed after a lost append reply. Every observed retained
descriptor must stay identical; conflicts refuse without repair. An output-budget
failure stays unknown with its complete known receipt, never truncated DATA.

The unified `readAdmittedConfigureAcknowledgement(token)` returns only actual
initial or recovered completion. Its output and receipt/raw-receipt identities
come from the actual returned wrapper. There is no caller receipt/output
registration API. Final guards precede quarantine discard without intervening
callbacks. Pending work, retirement or observed pointer changes cannot publish
late ACK custody or create another recovery reservation.

These are bounded read fences, not an atomic provider-writer lock. The recovery
is process-local and uses the same live Owner; persisted DATA cannot create a new
Owner or a cross-process execution grant. Public scheduling, cross-process
recovery, genuine generated/deployed compatibility, provider/native qualification
and complete Dojo adoption remain separate acceptance work.

## Component operation journal

The component's `renewalOperations` functions retain host-authorized operation
DATA separately from the process-local ownership and transport machinery above.
The host authenticates the caller and authorizes the exact operation before
calling these server functions. An operation ID, stored request, binding or
commit receipt does not establish provider provenance or a live owner.

`createAuthorizedOperation` stores the complete canonical JSON record and its
original authorization scope, revision and logical operation identity. An
identical canonical request returns the existing operation. Changing the full
request under the same logical identity returns a conflict and preserves the
original. A new authorization revision requires a new logical operation identity.
The finite JSON model preserves unknown nested fields, array order and own
properties, including absent versus null values. Original record JSON must fit
500,000 characters and UTF-8 bytes, 10,000 nodes and depth 40.

Legacy `schemaVersion: 1` records retain their existing shape. Attachment and
configure `schemaVersion: 2` records instead declare a closed `timingPolicy` with `version: 1`,
`firstDispatchedAt`, `periodStart`, `periodEnd`, `workEndWallMs` and `endWallMs`.
First-dispatch and period fields use epoch seconds; wall cutoff fields use epoch
milliseconds. They have no root `basis`; a policy does not establish a live
execution origin.

Before V2 attachment creation, a successful creation duplicate or a stored-source
read, the component reconstructs the actual pure C1 preparation from the complete
`attachRequest.preparation`, then reconstructs C2. The entire seven-field
dispatch, account, API version, request binding and policy must match the
retained source. A stored preparation flag or matching period fields alone
cannot replace these checks. The complete `originalBundle` remains opaque
host-authorized DATA: no layout or equality to the preparation is inferred.
Changing it still changes the immutable full record. Existing V1 records are
not migrated or supplied with a new basis.

A V2 configure record uses a separate logical operation identity, reservation,
request binding and C7 key. Its closed `configureRecord` contains `configuration`,
`request`, `attachReceipt` and the complete opaque `originalBundle`. Its closed
`parentAttachment` contains `operationId`, `attemptId`, `sourcePayloadId` and
`receiptBinding`. The host must authorize the exact parent and child pair. The
component does not impose equality on their host authorization scope strings.

Configure admission reconstructs C3, C6 and C7 and compares the complete dispatch,
account, API version, request and timing policy. A keyed parent lookup requires a
V2 attachment with its actual current attempt, bound basis, complete retained C3
and published receipt event 3. The child must match that complete C3, raw attachment
request and opaque original bundle. Its period and both wall cutoffs equal the
parent's policy. Binding the child requires exactly the parent's canonical basis
JSON, including the original wall and monotonic origins. Stored-source reads and
duplicate operations recheck these links and refuse corrupt DATA without repair.

This parent link establishes DATA consistency. Runtime configure admission still
requires a fresh winning child reservation, the actual live parent owner and its
actual returned attachment acknowledgement custody. Stored rows and equal basis
JSON cannot reconstruct those capabilities. Source tests use an isolated component;
genuine Convex generation, deployment and provider execution remain unverified.

`reserveAttempt` performs the first PREPARED-to-RESERVED transaction. Exactly one
winning invocation receives `acquired`; an identical later request receives
`existing` with the retained reservation. The result is DATA. Copying or loading
it cannot create a fresh execution capability. Expiry, process loss and a missing
reply do not release a new reservation or authorize another provider request.

A V2 reservation carries `recordVersion: 2` and complete canonical
`timingPolicyJSON` instead of legacy `basisJSON`. A reserved attempt with no
bound basis is valid only at head zero, without events or a known receipt.
This pending or orphaned DATA cannot authorize another execution.

`bindInitialBasis` accepts exactly `operationId`, `attemptId`, `policyJSON` and
`basisJSON`. The first binding requires the actual current V2 reservation,
head zero, no events and no known receipt. It atomically adds only an inline
`initialBasis` descriptor containing `version`, `attemptId`, `sourcePayloadId`,
`stage`, `policyJSON` and `basisJSON`; source, attempt and revision remain unchanged.
The result is `{ status: "bound", operationId, initialBasis }`.

The closed six-field basis DATA consists of `startWallMs`, `startNsDecimal`,
`workEndWallMs`, `workEndNsDecimal`, `endWallMs` and `endNsDecimal`. Wall values
must be safe nonnegative integers, with start strictly before the work cutoff.
Both cutoff wall values must equal the original policy. Nanoseconds use
canonical unsigned decimal strings within the u64 range. Exact BigInt arithmetic
checks each cutoff as `startNs + (cutoffWallMs - startWallMs) * 1000000`, with
ordered endpoints and no Number rounding.

The server checks arithmetic and retained identity without sampling a clock.
It does not establish current paid-period or replay-age eligibility. Those checks
require a separately qualified live invocation. Repeating the same complete
normalized binding returns the original descriptor without writes, including
after valid history and a known receipt. Changed input or corrupt retained
links, canonical JSON, arithmetic, history or known DATA refuses without repair.
Binding never reconstructs an owner from stored nanoseconds or extends a cutoff.

`appendStageEvent` compares the complete retained reservation and appends a
canonical event at the next sequence, from 1 through 3. An identical duplicate
returns the original commit receipt. A conflicting duplicate refuses without
replacing stored evidence. A dispatch event records intent, and a committed
receipt event does not establish that the host returned success to its caller.
V2 event writes require the checked bound basis for that same operation and
attempt. Events or a known receipt without a bound basis are corruption; they
cannot be adopted as a fresh binding.

`retainProviderAcknowledgement` reconstructs the complete attachment C3 or V2
configure C9 receipt from the checked source, dispatch and stored response. It compares
the full receipt and applies the existing whole-output JSON and privacy rules.
Configure C9 retention preserves the complete provider snapshot, transport,
C7 request and consistency bindings, including absent versus null default settings.
It means `configure_acknowledged`; it does not establish pending or effective
replacement. V1 configure records retain their previous acknowledgement behavior.
The transaction stores one owned receipt payload and a stable
`knownAcknowledgement` reference. It does not append receipt event 3.

A first retention must name the current history head, 2 or 3. When event 3
exists, its complete request and receipt must match. Retention at head 2 does
not model or impose the size of a prospective receipt event 3; an actual event 3
must independently satisfy the event JSON bounds. An identical retry returns
the original retention descriptor without writes. A caller that retained at
head 2 can repeat that same request after matching event 3 is appended. A
request for a future head refuses. Once a receipt is retained, event 3 must
match its complete request and receipt before any append writes; copying the
receipt binding alone is insufficient.

Operation payloads carry their immutable operation ID. Event payloads also carry
an attempt, stage and sequence. Receipt payloads carry their operation, attempt
and stage. Creation links a new source payload to its actual
operation within the same transaction. Readers refuse missing or conflicting
ownership links, even when a foreign payload has identical JSON and a matching
hash. They never infer or repair ownership from its contents.

For V2, complete owned history and any known receipt are also checked before
successful create-existing, reserve-existing and bind-duplicate returns, append
returns or writes, and all four queries below. These checks reconstruct the full
stage-specific C3 or C9 receipt and validate every retained source/event/receipt reference, payload
owner and complete canonical receipt JSON. An absent sequence or an identical
old event does not bypass corrupt known DATA. The acknowledgement getter reuses
that validated receipt; it does not treat a matching binding alone as sufficient.

Read complete retained data through the bounded query protocol:

| Query                         | Result                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `loadAuthorizedOperation`     | Full canonical `recordJSON` once, revision and an active-attempt summary containing the remaining reservation fields. |
| `readAttempt`                 | Complete reservation DATA and up to three ordered event descriptors, after validating the entire stored chain.        |
| `readStageEvent`              | One complete canonical event JSON and its descriptor, selected by operation ID, active attempt ID and sequence.       |
| `readProviderAcknowledgement` | `{ retention, receiptJSON }`, with the stable descriptor and full canonical receipt JSON once.                        |

A V1 load keeps its four keys: `operationId`, `recordJSON`, `revision` and
`activeAttempt`, with no added basis field. A V2 load has six keys: those four
plus `recordVersion: 2` and the complete `initialBasis` descriptor or null.
PREPARED revision zero has null attempt and basis. RESERVED revision one returns
the checked policy-only attempt summary and its bound basis, or null while still
unbound at head zero. Full source JSON appears only once in either load result.

An event descriptor contains the operation, attempt, stage, original source payload,
sequence, binding, event payload and event IDs. It contains no event JSON. Read
each manifested event separately, comparing its complete descriptor with the
manifest. Three events require one manifest query and three event queries.
Previously stored entries remain immutable if another event is appended between
reads; this protocol does not promise a snapshot across those calls.

A missing operation returns null. For `readAttempt` and
`readStageEvent`, an existing operation with a wrong or absent active attempt
refuses. A valid sequence beyond the committed chain returns null
only after the existing chain passes validation. Corrupt or incomplete history
never becomes an empty or partial successful result.

For `readProviderAcknowledgement`, null means no retained reference at the time
of the query. A present reference with a missing or corrupt receipt, source,
attempt or history refuses. This result cannot authorize another provider
request. Read full source and event JSON through the other bounded queries when
comparing the complete retained records.

These storage APIs do not activate the internal actors or add a public SDK
schedule writer. Host policy, actual runtime ownership, provider qualification
and restart recovery require their own integration. Stored DATA never revives an
old owner, resets a deadline or establishes delivery to a disconnected caller.

The private Action journal adapter binds one operation ID and captures eight
fixed generated references with the original Action methods and receiver. It
forwards complete component results, checks captured method identities before
each call, and rejects attempts to supply another operation ID or append a
foreign reservation. Host-authorized creation remains a separate component
operation. The adapter has no public package export, provider transport, live
owner or fresh execution handle. An acquired or existing reservation returned
through it is still storage DATA.

Its private C10 sender requires the unchanged reservation object returned by
that same adapter's actual reservation call. It canonicalizes the event, awaits
the fixed append, and validates the complete matching commit reply before
invoking the original acknowledgement callback once. Failure closes the sender
without retry or fallback. A committed event survives a later parent Action
failure; neither the callback nor the retained reply establishes live ownership,
provider provenance or delivery to the caller.

## Internal initial material consistency

The internal `renewalAttach/internal/material` classifiers compare complete
retained raw Subscription, target Price, billing Customer and Coupon evidence.
The retained classifier requires historical Coupon bodies. The fresh classifier
also requires the complete current bundle. Current reads cannot replace missing
historical evidence, and counter, unknown-field, array-order or reference-form
drift refuses classification.

Coupon joins are separate semantic values. The classifiers reconstruct each
Coupon association and supply only the two derived Discount arrays to the
existing eligibility predicates. They preserve the original raw bodies and
reference forms for comparison; an enriched Subscription is not relabeled as a
wire response. Hosts must retain those raw bundles separately. The existing
21-field material result does not add a durable raw-evidence storage guarantee.

Both classifiers use the same internal original owner before capture, around
constructor awaits and immediately before publishing the bounded result. The
three generated binding positions are checked against locally reconstructed
C1/C2 values. Other material remains subject to the private bounded-JSON policy;
this does not change the public preparation constructors' metadata policy.

These internal functions establish unsigned initial-material consistency only.
They have no package-root export, caller-supplied owner or proof input, registry
admission, provider call, recovery path or operational attachment entry. The
Source bindings remain unbound and the registry remains empty. A material result
is not an acknowledgement, custody record or provider/native qualification.

## Fixed acquisition profile

The initial profile supports platform requests using the configured
`2026-09-30.endive` API and Stripe 23 read shapes. Other versions reject before
reading. The public class selects the maintained single-attempt client,
including protection against the SDK's closed-connection special retry; every
read also requests zero automatic retries. Failures remain visible. There is no
fallback expansion, alternate endpoint or stale cache after a failed read.

The method performs these planned GETs in order:

1. Retrieve the exact subscription with `discounts`, `items.data.discounts`
   and `items.data.price` expanded.
2. Retrieve the exact target price.
3. Retrieve the actual subscription's Customer, correlated to the authorized
   customer-configured account and mode.
4. Retrieve each distinct coupon referenced by the expanded subscription/item
   discounts, in first-occurrence order. Each level is capped at 20 discounts,
   so at most 40 coupon GETs follow the three original reads.

Discounts must be expanded and have an actual coupon source. There is no
Discount retrieval endpoint used here. The item path
`items.data.discounts.source.coupon` exceeds the provider's four-property
expansion limit. Explicit coupon GET joins are part of the initial read plan,
including when a coupon was already expanded. Same-ID undeleted coupon results
expand string references in the canonical context. If a coupon was already
expanded, its complete canonical JSON must equal the separate GET result.
Duration, applicability, unknown fields and ordered arrays must agree; object
key order does not matter. Minimal expanded references and original-only or
GET-only fields are conservatively rejected as unsupported read-shape drift.
The join never merges or overwrites existing full source facts. Repeated
references are each compared, even when their coupon GET is deduplicated.
Contradictory available mode facts reject before a coupon GET.

All other full JSON fields, array ordering and unknown provider data are
retained within the existing bounded snapshot policy. No missing values become
null or empty lists. The result records `readProfile: "renewal-context-v1"`, a
server observation time and `providerQualification: "required"`. It does not
promise that multiple reads were atomic or that a context remains fresh later.
A preparation supplied from a different expansion/read shape must not be
silently rebound to this profile during a future writer invocation.

A nonnull observed `subscription.schedule` is returned as an observation. It is
not adopted as an acknowledgement of attachment. The existing initial pure
preparation still requires an unattached original. A later explicit replay of
an unknown attachment result needs a distinct material-state guard permitting
the actual nonnull association while preserving the original retained snapshot.
This reader does not fabricate a null association to bypass that guard.

## Bound request and remaining writer contract

The pure builder validates the retained logical preparation and explicit key.
It binds version, attach stage, platform scope, actual API version, logical
binding, method/path, complete payload `{ from_subscription: subscriptionId }`,
key and original first-dispatch time. It generates no phase, metadata, arbitrary
create option, receipt or provider acknowledgement.

No attachment writer is exposed by these helpers. There are currently no
accepted provider execution profiles. A positive structural preflight remains
insufficient to authorize a POST; callers cannot unlock one with a qualification
flag. Direct existing forever discount IDs are representable by the projection
helpers, while actual mirroring and preservation require separate provider
qualification. Empty discount reads do not prove suppression versus inheritance
and remain unsupported at projection preflight, even when the Customer has no
observed discount. Reading such facts does not qualify their transition.

A future writer must reacquire this full scoped context before its one POST.
Initial dispatch requires no attached schedule. Explicit lost-response replay
must use the same retained full request/key/time, permit a newly observed
nonnull association without adopting it by shape, and keep provider conflicts
visible. A local replay age limit below 24 hours cannot guarantee replay after
provider pruning. No retries, configure chaining or cancel/release rollback are
implemented here. A successful future attachment acknowledgement must remain
`attached_unconfigured`; target pending/effective states require separately
qualified configuration and observation.

See the [replacement contract](renewal-price-replacements.md) and
[phase assembly](renewal-phase-assembly.md) for baseline, replay and observation
boundaries. Read comparison is best effort and cannot exclude concurrent
Dashboard or other provider writers.

## Wire JSON and transport status

Renewal reads use Stripe's public `rawRequest` for a fixed set of subscription,
Price, Customer and coupon GET endpoints. Each resource ID is encoded as one path
segment. Dot-only coupon IDs `.` and `..` are rejected before dispatch because
URL parsing would normalize them into different resource paths. The subscription's
fixed ordered expansion query is in the GET path,
with no GET body. Callers cannot supply endpoints, headers or expansion options.
The API version, platform scope and zero automatic network retries remain fixed.

Typed Stripe resource methods can convert decimal strings into SDK `Decimal`
objects. The raw request boundary preserves the parsed wire JSON instead,
including decimal string spelling, required native Plan fields and unknown
provider fields. The strict bounded JSON snapshot validator is unchanged. No
`Decimal.toString()` conversion, financial calculation or selective field
replacement makes unsupported evidence acceptable. This preserves JSON values,
not the original response whitespace or numeric token spelling.

A fulfilled SDK promise alone does not establish HTTP success. Each renewal
response must have actual successful transport status metadata. Fetch exposes
`lastResponse.status`; Node exposes `lastResponse.statusCode`. Missing, malformed,
contradictory or non-2xx metadata rejects the read. This nonenumerable transport
metadata stays outside the canonical provider body. Provider errors stay visible,
and these read checks do not acknowledge a schedule mutation.

The shared single-attempt client rejects fetch redirects as well as Stripe's
closed-connection retry exception. A 307 or 308 cannot silently replay a POST.
The ordinary client route keeps its existing transport behavior. Rejected
redirects and broken connections can leave a remote outcome unknown; callers
must retain the original request identity rather than rotate or resend
automatically. These transport safeguards do not qualify a renewal provider
profile or authorize attachment, configuration or entitlement changes.

## Additive async V2 preparation

Use the explicitly named V2 functions when compact SHA-256 consistency bindings
are needed. Existing V1 functions and retained V1 records keep their current
format and synchronous behavior.

```ts
import {
  prepareRenewalPriceReplacementV2,
  prepareRenewalScheduleAttachmentV2,
} from "@fantastic.dev/better-stripe";

const preparedV2 = await prepareRenewalPriceReplacementV2({
  subscription: context.subscription,
  targetPrice: context.targetPrice,
  billingCustomer: context.billingCustomer,
  expected,
  key: logicalKey,
});
const attachRequestV2 = await prepareRenewalScheduleAttachmentV2({
  prepared: preparedV2,
  apiVersion: context.apiVersion,
  attachKey,
  firstDispatchedAt,
});
```

Both functions are pure. They perform no provider request, generate no key,
persist no record and establish no provider qualification. The V2 attachment
builder accepts only a complete V2 preparation. It reconstructs that preparation
from its full provider snapshot, expected selectors and retained logical key,
and compares the entire result before constructing the request. A matching
digest alone is insufficient. V1 preparations are rejected by this builder;
there is no automatic migration or fallback. Existing V1 projection, receipt
and configure consumers do not accept V2 records. V2 adds pure preparation,
request and attachment-receipt construction, plus
[raw configuration projection](renewal-phase-assembly.md#raw-v2-configuration-projection).
It also adds [configured-response receipt consistency](renewal-phase-assembly.md#raw-v2-configuration-receipts).
These constructors do not add a provider writer.

V2 retains the same raw preparation semantic checks and bounded JSON policy as
V1. It adds a limit of 500,000 UTF-8 bytes on each exact encoded hash preimage,
including its domain tuple. A record can therefore fit V1's character limit
and exceed V2's byte limit. Inputs are captured before awaiting hashing; changes
to the original caller object during the await cannot change the result. Web
Crypto SHA-256 must be available. Missing or rejected digest operations fail
without an alternate algorithm or synchronous fallback.

For a fixed family, the hash input is the UTF-8 encoding of the current bounded
`renewalSnapshot` canonical copy followed by `JSON.stringify`, applied to
`["betterstripe-renewal-binding", 2, family, completePreimage]`. Object keys use
the existing ordering, including JavaScript's numeric-index enumeration;
arrays retain their order and negative zero serializes as zero. The output is
`family:v2:sha256:` followed by the full 64 lowercase hexadecimal digest.
Families are selected internally: `renewal` for preparation and
`renewal-attach` for the attachment request and `renewal-attach-receipt` for the
complete attachment receipt.
Configuration projection also selects `renewal-baseline`, `renewal-defaults`
and `renewal-configure` internally for its complete baseline, defaults and
unsigned request. No caller-supplied family selector is exposed.
Configured-response receipts select `renewal-configured-baseline` for the full
response body, `renewal-configured-defaults` when that body owns default settings,
and `renewal-configure-receipt` for the complete unsigned receipt.

The preparation preimage contains version, platform scope, expected selectors,
quantity and complete provider snapshot. Its logical key is separately retained
and validated, as in V1; changing only that valid key does not change the
preparation digest. Hosts must protect original key lineage through immutable
authorization and storage. The attachment preimage binds its entire unsigned
request, including stage, scope, actual API version, logical binding, POST path,
complete payload, explicit attachment key and original first-dispatch time.
Neither digest authenticates a caller, proves provenance, acknowledges a POST
or guarantees provider replay. Hosts retain the complete original records.

### V2 attachment receipt consistency

`constructRenewalScheduleAttachmentReceiptV2` constructs unsigned receipt data
from raw preparation inputs, the complete actual dispatch and the retained
Schedule body:

```ts
import { constructRenewalScheduleAttachmentReceiptV2 } from "@fantastic.dev/better-stripe";

const receiptV2 = await constructRenewalScheduleAttachmentReceiptV2({
  attachRequest: {
    preparation: {
      subscription: context.subscription,
      targetPrice: context.targetPrice,
      billingCustomer: context.billingCustomer,
      expected,
      key: logicalKey,
    },
    apiVersion: context.apiVersion,
    attachKey,
    firstDispatchedAt,
  },
  actualDispatch: {
    scope: "platform",
    apiVersion: context.apiVersion,
    method: "POST",
    path: "/v1/subscription_schedules",
    payload: { from_subscription: expected.subscriptionId },
    key: attachKey,
    firstDispatchedAt,
  },
  providerSnapshot: retainedScheduleBody,
});
```

Supply the original raw preparation and dispatch facts from protected host
storage. The constructor rebuilds C1 and C2 itself. It accepts neither a prepared
record in place of raw preparation nor caller-supplied verification flags. All
seven dispatch fields must equal the rebuilt request, including its complete
payload, explicit key and original first-dispatch time. A retained billing
Customer is required.

The Schedule must match the expected subscription, Customer, customer account
and mode. Available expanded identity relations must agree, including their
declared Customer, subscription and Schedule references. Deleted identities
reject. The complete Schedule body, including unknown JSON fields, remains in
the receipt and its `renewal-attach-receipt` binding. The receipt also binds its
entire rebuilt attachment request and logical binding. Its version is `2` and
stage is `attached_unconfigured`.

The constructor captures all raw inputs before its first await. Closed input
objects require own data properties and reject unexpected names; the captured
copy is checked again before hashing. Raw provider records retain the existing
bounded JSON policy. Each digest preimage, including its domain tuple and all
nested records, remains limited to 500,000 UTF-8 bytes.

This pure function performs no HTTP request or storage operation. Matching data
does not authenticate a response, prove that a POST succeeded, establish
ownership, qualify a provider profile or authorize configuration. A coherent
unsigned forgery can pass. No transport status or observation time is invented.
Hosts must separately establish acknowledgement provenance and preserve the
original records. Existing V1 configure and receipt consumers still reject V2.
There is no public migration or V2 configure executor. The internal configure
writer has empty Source bindings and requires separate operation, transport and
custody qualification before it can be enabled; see
[renewal phase assembly](renewal-phase-assembly.md#internal-configure-dispatch-and-explicit-replay).

These helpers retain ordinary provider and caller metadata within their JSON
limits. They do not redact, encrypt or certify that input or output is safe to
log. Do not place secrets in metadata, and protect retained full records.

### Private retained observation history DATA

The private `captureRetainedObservationHistory` helper reconstructs a complete
retained history snapshot without selecting a client or creating a read or write
Owner. Its input has exactly `parent` and `configure`. Each contains the complete
`operation`, `attempt`, `events` and `acknowledgement` query results. An active
reserved v2 attachment parent must have three complete events and full retained
C3. The reserved v3 configure child may have zero through three events. Standalone
attachment history at head two and unreserved configure operations are outside
this increment.

The helper copies and freezes the entire own-DATA graph before its first await.
The aggregate input is limited to 10,000 traversal nodes, depth 40 and 500,000
UTF-8 bytes, with the existing component return-value limits also enforced.
Proxies, accessors, hidden properties, sparse arrays and unsupported values reject.
Every full event must match its manifest and canonical event binding. Full C3,
C7, original raw material, account, API, parent linkage, period/deadline policy and
bound basis must agree. Parent and child host authorization envelopes may differ.
Only a head-zero child may have an unbound basis. Operation, attempt, event and
payload identities must not alias.

Missing C9 is valid at child heads zero, one and two. A complete response at head
two is checked against the original request and configuration, but reconstruction
alone does not make a receipt retained. A supplied C9 must match the full response,
canonical receipt JSON and retention references. Head three requires retained C9.
The output preserves the full detached snapshot and original configuration. Its
authentication, public delivery and operational-authority flags are false.

These are unsigned historical DATA checks. They do not prove an actual returned
ACK, grant fresh authorization, revive an expired Owner or permit replay. The
future-period observation entry still needs fresh host authorization, a separate
bounded GET-only lifetime and complete lifecycle/invoice/history acquisition.
Production Source profiles remain empty. Provider qualification, genuine
generation/deployed compatibility and final Dojo acceptance remain outstanding.
