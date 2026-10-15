// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { setup } from "./payoutExecutionTestHelpers.js";
it("does not pay a stale liability amount when a refund cost arrives before the attempt", async () => {
 const s=await setup();const verified=await s.verify();
 s.verify.mockResolvedValueOnce(verified).mockImplementationOnce(async()=>{
  await s.t.mutation(makeFunctionReference<"mutation">("costRecovery/mutations:record"),{
   accountId:"acct_recipient",scopeKey:"store:owner",currency:"usd",claimKey:"refund:new",sourceChargeId:"ch_refunded",sourceGross:1000,sourceProcessingFee:1,amountDue:1,revision:1,
  });
  return verified;
 });
 await s.run();
 expect(s.provider.payouts.create).not.toHaveBeenCalled();
});
