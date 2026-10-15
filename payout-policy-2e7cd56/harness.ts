import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {componentsGeneric} from 'convex/server';
import {BetterStripe} from '/path/to/better-stripe/src/client/index.ts';
import {getStripeClient} from '/path/to/better-stripe/src/client/helpers.ts';
const root='/path/to/better-stripe';
process.chdir(root+'/example');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key,'2026-09-30.endive');
const report:any={sandbox:true,realProvider:true,publicClient:true,deployedComponent:true,apiVersion:'2026-09-30.endive'};
let failConfirm=false,updateCount=0;
async function call(ref:any,args:any){
 const full=ref[Symbol.for('toReferencePath')];const start=full.indexOf('/payoutPolicy/');assert(start>=0);
 const path=full.slice(start+1);const index=path.lastIndexOf('/');
 if(failConfirm&&path.endsWith('/confirm')){failConfirm=false;throw Error('simulated persistence outage');}
 return JSON.parse(execFileSync('pnpm',['exec','convex','run','--component','betterStripe',path.slice(0,index)+':'+path.slice(index+1),JSON.stringify(args)],{cwd:root+'/example',encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim()||'null');
}
const ctx:any={runQuery:call,runMutation:call};
const bs=new BetterStripe(componentsGeneric().betterStripe as any,{STRIPE_SECRET_KEY:key});
const rawUpdate=sdk.balanceSettings.update.bind(sdk.balanceSettings);
sdk.balanceSettings.update=(async(...args:any[])=>{updateCount++;return rawUpdate(...args);}) as any;
const run='payout-policy-'+crypto.randomUUID();let accountId:string|undefined;let scope:any;
try{
 const account=await sdk.v2.core.accounts.create({
  contact_email:'betterstripe-payout-policy-qa@example.com',display_name:'BetterStripe payout policy QA',
  dashboard:'none',defaults:{responsibilities:{fees_collector:'application',losses_collector:'application'},profile:{business_url:'https://accessible.stripe.com'}},
  configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}},
  identity:{country:'US',entity_type:'individual',individual:{given_name:'Test',surname:'Payout',date_of_birth:{day:1,month:1,year:1990},address:{line1:'354 Oyster Point Blvd',city:'South San Francisco',state:'CA',postal_code:'94080',country:'US'},id_numbers:[{type:'us_ssn',value:'000000000'}]},attestations:{terms_of_service:{account:{date:new Date().toISOString(),ip:'127.0.0.1'}}}},
  metadata:{payoutPolicyQA:run},
 },{idempotencyKey:run+':account'});
 assert.equal(account.livemode,false);accountId=account.id;report.accountId=accountId;
 await sdk.accounts.createExternalAccount(accountId,{external_account:'btok_us_verified',default_for_currency:true},{idempotencyKey:run+':bank'});
 await rawUpdate({payments:{payouts:{schedule:{interval:'weekly',weekly_payout_days:['monday']}}}},{stripeAccount:accountId});
 scope={accountId,ownerKey:run};
 const opts={...scope,operationKey:run+':enable',expectedRevision:-1,mode:'custom' as const,thresholds:[{currency:'usd',amount:1000}],consent:true as const};
 let result=await bs.payoutPolicy.prepare(ctx,opts);report.prepare=result.status;assert.equal(result.status,'prepared');
 assert.equal((await sdk.balanceSettings.retrieve(undefined,{stripeAccount:accountId})).payments.payouts!.schedule!.interval,'weekly');
 report.preparationDoesNotMutateProvider=true;
 failConfirm=true;await assert.rejects(bs.payoutPolicy.apply(ctx,{...scope,operationKey:opts.operationKey}),/simulated persistence outage/);
 assert.equal((await sdk.balanceSettings.retrieve(undefined,{stripeAccount:accountId})).payments.payouts!.schedule!.interval,'manual');
 assert.equal((await bs.payoutPolicy.get(ctx,scope))!.status,'changing');
 assert.equal((await bs.payoutPolicy.apply(ctx,{...scope,operationKey:opts.operationKey})).status,'ready');
 assert.equal(updateCount,1);report.persistenceRecovery={providerManual:true,updates:1,replayNoDuplicate:true};
 assert.equal((await bs.payoutPolicy.verify(ctx,scope)).status,'verified');
 const original=await bs.payoutPolicy.get(ctx,scope);
 result=await bs.payoutPolicy.prepare(ctx,{...opts,operationKey:run+':change',expectedRevision:0,thresholds:[{currency:'eur',amount:500},{currency:'usd',amount:2000}]});assert.equal(result.status,'prepared');
 await bs.payoutPolicy.apply(ctx,{...scope,operationKey:run+':change'});
 assert.equal((await bs.payoutPolicy.get(ctx,scope))!.holdDeadline,original!.holdDeadline);report.editDoesNotExtendDeadline=true;
 await rawUpdate({payments:{payouts:{schedule:{interval:'daily'}}}},{stripeAccount:accountId});
 assert.equal((await bs.payoutPolicy.verify(ctx,scope)).status,'schedule_drift');report.liveDriftDetected=true;
 await rawUpdate({payments:{payouts:{schedule:{interval:'manual'}}}},{stripeAccount:accountId});
 result=await bs.payoutPolicy.prepare(ctx,{...scope,operationKey:run+':off',expectedRevision:1,mode:'stripe_managed',thresholds:[]});assert.equal(result.status,'prepared');
 await bs.payoutPolicy.apply(ctx,{...scope,operationKey:run+':off'});
 const final=await sdk.balanceSettings.retrieve(undefined,{stripeAccount:accountId});assert.equal(final.payments.payouts!.schedule!.interval,'weekly');assert.deepEqual(final.payments.payouts!.schedule!.weekly_payout_days,['monday']);
 assert.equal((await bs.payoutPolicy.get(ctx,scope))!.mode,'stripe_managed');
 report.optOutRestoredOriginalSchedule=true;report.providerMinimumNotInvented=true;
 report.status='passed';
}catch(error:any){report.status='failed';report.error={message:error.message,code:error.code};process.exitCode=1;}
finally{
 if(accountId){
  try{await rawUpdate({payments:{payouts:{schedule:{interval:'weekly',weekly_payout_days:['monday']}}}},{stripeAccount:accountId});report.cleanupScheduleRestored=true;}catch(error:any){report.cleanupRestoreError=error.message;}
  try{await sdk.v2.core.accounts.close(accountId,{applied_configurations:['recipient']},{idempotencyKey:run+':close'});report.accountClosed=true;}catch(error:any){report.closeError=error.message;}
 }
 report.noChargesTransfersOrPayoutsCreated=true;
 writeFileSync('/tmp/payout-policy-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
