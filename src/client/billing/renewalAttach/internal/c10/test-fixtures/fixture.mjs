// Raw synthetic sources only; never imports the TEST owner/model/first-construction entry.
import { instantiateRequired } from "./frozen/f24.mjs";
import * as sdk from "../../../../renewalV2/index.js";
export const copy = (x) => structuredClone(x);
export const wire = (x) => ({
  scope: x.scope,
  apiVersion: x.apiVersion,
  method: x.method,
  path: x.path,
  payload: copy(x.payload),
  key: x.key,
  firstDispatchedAt: x.firstDispatchedAt,
});
export async function fixture() {
  const s = instantiateRequired(),
    sourceAttach = copy(s.attach.attachRequest),
    sourceConfigure = copy(s.configuration);
  const prepared = await sdk.prepareRenewalPriceReplacementV2(
      sourceAttach.preparation,
    ),
    request = await sdk.prepareRenewalScheduleAttachmentV2({
      prepared,
      apiVersion: sourceAttach.apiVersion,
      attachKey: sourceAttach.attachKey,
      firstDispatchedAt: sourceAttach.firstDispatchedAt,
    }),
    attach = await sdk.constructRenewalScheduleAttachmentReceiptV2(s.attach),
    configure = await sdk.projectRenewalConfigurationV2(sourceConfigure);
  if (configure.status !== "projected_configure_request")
    throw Error("SYNTHETIC_CONFIGURE_UNSUPPORTED");
  const transport = { status: 200, requestId: "req_SYNTHETIC_C10" },
    stored = await sdk.constructRenewalConfigurationReceiptV2({
      configuration: sourceConfigure,
      actualDispatch: s.configuredDispatch,
      providerSnapshot: s.configuredBody,
      transport,
    });
  return {
    s,
    sourceAttach,
    sourceConfigure,
    request,
    attach,
    configure,
    stored,
    transport,
  };
}
export { sdk };
