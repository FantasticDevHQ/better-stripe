import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';import {componentsGeneric} from 'convex/server';
import {BetterStripe} from '/path/to/better-stripe/src/client/index.ts';import {getStripeClient} from '/path/to/better-stripe/src/client/helpers.ts';
const root='/path/to/better-stripe';process.chdir(root+'/example');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY','--deployment','healthy-wolf-458'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key,'2026-09-30.preview');assert.equal((await sdk.accounts.retrieve()).id,'acct_1SIJDVL9QFmKeSCO');
let failBind=false;async function call(ref:any,args:any){const full=ref[Symbol.for('toReferencePath')];const path=full.slice(full.indexOf('/costRecovery/')+1);assert(path.startsWith('costRecovery/'));if(failBind&&path.endsWith('/bindInvoiceItem')){failBind=false;throw Error('simulated persistence outage');}const i=path.lastIndexOf('/');return JSON.parse(execFileSync('pnpm',['exec','convex','run','--component','betterStripe',path.slice(0,i)+':'+path.slice(i+1),JSON.stringify(args)],{cwd:root+'/example',encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim()||'null');}
const ctx:any={runQuery:call,runMutation:call};const bs=new BetterStripe(componentsGeneric().betterStripe as any,{STRIPE_SECRET_KEY:key,stripeApiVersion:'2026-09-30.preview'});const recovery=bs.costRecovery;const ledger=(opts:any)=>recovery.balance(ctx,{accountId:opts.accountId,scopeKey:opts.scopeKey,currency:opts.currency});
const run='recovery-invoice-'+crypto.randomUUID();const report:any={sandbox:true,realProvider:true,deployedComponent:true,publicClient:true,apiVersion:'2026-09-30.preview'};const invoices:string[]=[];let sourcePi:string|undefined,fundingPi:string|undefined;const claims:any[]=[];
async function seed(invoiceId:string,accountId:string,amount:number,suffix:string,currency='usd'){const scope={accountId,scopeKey:run+':'+suffix,currency};const claim={...scope,claimKey:run+':'+suffix,sourceChargeId:'ch_qa_original',sourceGross:10000,sourceProcessingFee:320,amountDue:amount,revision:1};claims.push(claim);await recovery.recordClaim(ctx,claim);const groupKey=run+':'+suffix;await recovery.reserve(ctx,{...scope,groupKey,operationKey:groupKey+':batch1',sourceKind:'invoice',sourceId:invoiceId,maxDebit:10000,maxCredit:10000});await recovery.seal(ctx,{groupKey});return {...scope,groupKey};}
async function costs(pi:string){for(let i=0;i<35;i++){const cost=await bs.getProcessingCostContext(ctx,{paymentIntentId:pi});if(cost.status==='ready')return cost;await delay(1500);}throw Error('provider costs not ready');}

const account=await sdk.v2.core.accounts.create({display_name:'BetterStripe invoice authorization QA',identity:{country:'us'},configuration:{customer:{}}},{idempotencyKey:run+':owner'});
const invoice=await sdk.invoices.create({customer_account:account.id,currency:'usd',auto_advance:false},{idempotencyKey:run+':invoice'});
try {
 const completed=await seed(invoice.id,account.id,100,'completed');await recovery.finish(ctx,{groupKey:completed.groupKey,outcome:'collect'});await assert.rejects(recovery.attachInvoice(ctx,completed),/sealed/);report.completedGroupCannotCreateNewItem=true;
 const wrongOwner=await seed(invoice.id,'acct_wrong_owner',100,'owner');await assert.rejects(recovery.attachInvoice(ctx,wrongOwner),/ownership/);
 const wrongCurrency=await seed(invoice.id,account.id,100,'currency','eur');await assert.rejects(recovery.attachInvoice(ctx,wrongCurrency),/currency/);
 assert.equal((await sdk.invoiceItems.list({invoice:invoice.id})).data.length,0);
 for(const opts of [wrongOwner,wrongCurrency])await recovery.finish(ctx,{groupKey:opts.groupKey,outcome:'release'});
 for(const claim of claims){const current=await recovery.getClaim(ctx,{claimKey:claim.claimKey});await recovery.recordClaim(ctx,{...claim,revision:2,amountDue:current!.collectedAmount});}
 report.status='passed';report.providerOwnershipRejected=true;report.providerCurrencyRejected=true;report.noProviderItemsCreated=true;report.closedQaClaims=true;
} catch(error:any) {report.status='failed';report.error=error.message;process.exitCode=1;}
finally {await sdk.invoices.del(invoice.id);report.draftRemoved=true;writeFileSync('/tmp/cost-recovery-invoices-auth-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
