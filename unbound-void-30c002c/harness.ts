import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';import {componentsGeneric} from 'convex/server';
import {BetterStripe} from '/path/to/better-stripe/src/client/index.ts';import {getStripeClient} from '/path/to/better-stripe/src/client/helpers.ts';
const root='/path/to/better-stripe';process.chdir(root+'/example');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY','--deployment','healthy-wolf-458'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key,'2026-09-30.preview');assert.equal((await sdk.accounts.retrieve()).id,'acct_1SIJDVL9QFmKeSCO');
let failBind=false;async function call(ref:any,args:any){const full=ref[Symbol.for('toReferencePath')];const path=full.slice(full.indexOf('/costRecovery/')+1);assert(path.startsWith('costRecovery/'));if(failBind&&path.endsWith('/bindInvoiceItem')){failBind=false;throw Error('simulated persistence outage');}const i=path.lastIndexOf('/');return JSON.parse(execFileSync('pnpm',['exec','convex','run','--component','betterStripe',path.slice(0,i)+':'+path.slice(i+1),JSON.stringify(args)],{cwd:root+'/example',encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim()||'null');}
const ctx:any={runQuery:call,runMutation:call};const bs=new BetterStripe(componentsGeneric().betterStripe as any,{STRIPE_SECRET_KEY:key,stripeApiVersion:'2026-09-30.preview'});const recovery=bs.costRecovery;const ledger=(opts:any)=>recovery.balance(ctx,{accountId:opts.accountId,scopeKey:opts.scopeKey,currency:opts.currency});
const run='recovery-unbound-void-'+crypto.randomUUID();
const report:any={sandbox:true,realProvider:true,deployedComponent:true,publicClient:true,apiVersion:'2026-09-30.preview',noPaymentAttempt:true};
let invoiceId:string|undefined;let opts:any;
try {
 const account=await sdk.v2.core.accounts.create({display_name:'BetterStripe unbound void QA',contact_email:'betterstripe-qa@example.com',identity:{country:'us'},configuration:{customer:{}}},{idempotencyKey:run+':customer'});
 const invoice=await sdk.invoices.create({customer_account:account.id,currency:'usd',auto_advance:false},{idempotencyKey:run+':invoice'});invoiceId=invoice.id;
 await sdk.invoiceItems.create({invoice:invoice.id,customer_account:account.id,amount:900,currency:'usd',description:'QA unpaid plan',discountable:false},{idempotencyKey:run+':plan'});
 const scope={accountId:account.id,scopeKey:run,currency:'usd'};opts={...scope,groupKey:run};
 await recovery.recordClaim(ctx,{...scope,claimKey:run,sourceChargeId:run+':synthetic-original',sourceGross:10000,sourceProcessingFee:320,amountDue:320,revision:1});
 await recovery.reserve(ctx,{...opts,operationKey:run+':batch',sourceKind:'invoice',sourceId:invoice.id,maxDebit:320,maxCredit:0});await recovery.seal(ctx,{groupKey:run});
 await sdk.invoices.finalizeInvoice(invoice.id,{auto_advance:false});
 await assert.rejects(recovery.reconcileInvoice(ctx,opts),/missing/);assert.equal((await ledger(opts)).reservedAmount,320);report.openInvoiceKeepsReservation=true;
 await sdk.invoices.voidInvoice(invoice.id);
 const receipt=await recovery.reconcileInvoice(ctx,opts);assert.equal(receipt.invoiceItemId,null);assert.equal(receipt.isDone,true);await recovery.reconcileInvoice(ctx,opts);
 const balance=await ledger(opts);assert.equal(balance.reservedAmount,0);assert.equal(balance.collectedAmount,0);assert.equal(balance.outstanding,320);report.voidReleasesExactlyOnce=true;
 let adjustments=0;for await(const item of sdk.invoiceItems.list({invoice:invoice.id,limit:100}))if(item.metadata?.bsRecoveryGroup)adjustments++;assert.equal(adjustments,0);report.noRecoveryItemCreated=true;
 // Clear the synthetic QA obligation after proving it becomes available again.
 await recovery.recordClaim(ctx,{...scope,claimKey:run,sourceChargeId:run+':synthetic-original',sourceGross:10000,sourceProcessingFee:320,amountDue:0,revision:2});
 report.finalBalance=await ledger(opts);assert.equal(report.finalBalance.outstanding,0);report.status='passed';
} catch(error:any){report.status='failed';report.error={message:error.message,code:error.code};process.exitCode=1;}
finally {if(invoiceId){const invoice=await sdk.invoices.retrieve(invoiceId);if(invoice.status==='draft')await sdk.invoices.del(invoiceId);else if(invoice.status==='open')await sdk.invoices.voidInvoice(invoiceId);}writeFileSync('/tmp/recovery-void-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
