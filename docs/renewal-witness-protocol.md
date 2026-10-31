# Immutable renewal witness protocol

This component protocol stores complete unsigned renewal snapshot DATA. It is
the persistence prerequisite for historical acquisition, not an activated
capture or authorization API. It adds a table and ordinary transactional helpers,
with no registered production query or mutation. Live capture, separate host
retain/read capabilities, actual returned acknowledgement custody and genuine
generated routes remain required in BTS-320.

## Payload and source checks

The canonical envelope contains exact installation/witness/parent/configure
identity, captured subject, bounded acquisition metadata, complete source records
and reservations, retained attachment receipt, optional retained configure
receipt, full raw reads and optional complete invoice context. Unknown resource
fields, own null values and wire decimal strings remain intact.

Acquisition metadata names the base 44-read profile and a separate nullable
seven-extra-read invoice profile. Wall and canonical decimal nanosecond durations
must fit the original 30-second profile; the derived wall start is nonnegative.
These are unsigned metadata checks. They establish neither an actual invocation
nor provider historical time.

At both retain and read boundaries, validation reloads the actual original
component records, payload owners, active reservations, parent basis, complete
event chains and retained acknowledgements. It checks the parent link and full
stored source against those records. Configure events must match the complete
C7 request; response2 is reconstructed even without retained C9. Opaque generic
journal events do not qualify this protocol. Full stage events need not be
duplicated in each witness because their actual immutable records are checked.

Configuration comes from the complete C7 record. Captured-present C9 must match
its full retained counterpart; raw constructor input is reconstructed from exact
dispatch, provider snapshot and transport. Captured-null C9 remains null even if
a valid C9 is retained later. Later journal integrity is checked without
injecting the newer receipt into the stored snapshot.

The existing evidence analyzer must recompute `current_target_material_match`.
If invoice context is included, it must also supply complete paired correlation.
Stored analysis flags and hashes alone do not qualify material. Descriptor
scope, successor item and native period derive from the complete admitted
evidence. No live provider resource is fetched during persistence or retrieval.

## Immutable transactions and bounds

The logical uniqueness key is installation `componentScope` plus `witnessId`.
The complete identity additionally binds parent and configure operation IDs.
Indexed lookups use `take(2)` to detect duplicate rows. First identity wins:
identical canonical payloads return the same descriptor, while a changed payload
or operation under that key conflicts. The protocol never overwrites, repairs
or chooses a new identity automatically.

A read checks the full requested identity before releasing content. Wrong
installation, witness or operation returns no payload. The stored payload is
revalidated against original component context and its full digest; corrupted,
missing or duplicate source/storage rows refuse. Later live resource drift does
not replace the earlier snapshot.

The complete canonical envelope keeps the existing 500,000-byte, 10,000-node and
40-depth bounds. Before insertion, the protocol also charges the complete stored
value and full read reply, reserving the admitted maximum opaque ID length for
its future descriptor. It never crops resources to fit. Transactional helpers
are intended for one retain operation per registered transaction; normal Convex
transaction concurrency provides the first-wins behavior across calls.

## Retention and historical meaning

A successful transaction returns a row descriptor and full payload binding. It
does not prove that an external caller received that result. A lost response can
leave a durable row with no returned public acknowledgement. An explicit later
identical request can recover the same descriptor, subject to the separate host
policy and runtime custody checks required by BTS-320.

Descriptors always report false authentication, operational authority and public
delivery, with provider qualification still required. The captured subject is
immutable DATA, not permission for a later reader. A later host authorization
may permit a different subject without rewriting the capture.

Stored raw material may supply `{reads, invoiceContext}` to the historical
evidence axis, independently of later live settings or terminal drift. It does
not revive a write Owner, manufacture a native past observation, prove atomic
acquisition or establish exclusive causality. Fetching an old invoice later is
not a substitute for the complete active snapshot.

The controlled tests exercise real component transaction helpers and journal
records. Production route generation, deployment, native/provider qualification,
actual capture/read integration, release acceptance and Dojo adoption remain
separate requirements. Existing execution holds remain in force.
