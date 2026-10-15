import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {componentsGeneric} from 'convex/server';
const root=process.env.BETTER_STRIPE_REPO??process.cwd();const cwd=root+'/example';
const {BetterStripe}=await import(root+'/src/client/index.ts');
const {getStripeClient}=await import(root+'/src/client/helpers.ts');
const {transferFingerprint}=await import(root+'/src/component/payoutRelease/helpers.ts');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key);const bs=new BetterStripe(componentsGeneric().betterStripe as never,{STRIPE_SECRET_KEY:key});
const failBank=process.env.BETTER_STRIPE_QA_BANK_FAILURE==='1';
const run='payout-reconciliation-qa-'+crypto.randomUUID();
const report:any={scenario:failBank?'bank_insufficient_funds':'successful_bank_payout',sandbox:true,publicPackage:true,realProvider:true,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),run};
let accountId:string|undefined,transferId:string|undefined,payoutId:string|undefined,scope:any,claimKey:string|undefined,createAttempted=false,restoreRevision:number|undefined,failRecording=false;
let payoutCreates=0;const create=sdk.payouts.create.bind(sdk.payouts);sdk.payouts.create=(async(...args:any[])=>{payoutCreates++;return create(...args);}) as never;
function callPath(path:string,args:any){assert(/^(payoutPolicy|payoutRelease|connect)\/(queries|mutations):\w+$/.test(path));return JSON.parse(execFileSync('pnpm',['exec','convex','run','--component','betterStripe',path,JSON.stringify(args)],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim()||'null');}
async function call(ref:any,args:any){const full=ref[Symbol.for('toReferencePath')];const found=full.match(/\/((?:payoutPolicy|payoutRelease|connect)\/(?:queries|mutations)\/\w+)$/);assert(found);const path=found[1].replace(/\/(\w+)$/,':$1');if(failRecording&&path==='payoutRelease/mutations:recordOutcome'){failRecording=false;throw Error('simulated recording outage');}return callPath(path,args);}
const ctx:any={runQuery:call,runMutation:call};
try{
 assert.deepEqual(callPath('payoutRelease/queries:fees',{accountId:'acct_preflight',ownerKey:'preflight',currency:'usd'}),{amount:0,revision:0});
 console.log('Creating isolated sandbox recipient');
 const a=await sdk.v2.core.accounts.create({contact_email:'betterstripe-payout-reconciliation-qa@example.com',display_name:'BetterStripe payout reconciliation QA',dashboard:'none',
  defaults:{responsibilities:{fees_collector:'application',losses_collector:'application'},profile:{business_url:'https://accessible.stripe.com'}},
  configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}},
  identity:{country:'US',entity_type:'individual',individual:{given_name:'Test',surname:'Payout',date_of_birth:{day:1,month:1,year:1990},address:{line1:'354 Oyster Point Blvd',city:'South San Francisco',state:'CA',postal_code:'94080',country:'US'},id_numbers:[{type:'us_ssn',value:'000000000'}]},attestations:{terms_of_service:{account:{date:new Date().toISOString(),ip:'127.0.0.1'}}}},metadata:{payoutReconciliationQA:run}}, {idempotencyKey:run+':account'});
 assert.equal(a.livemode,false);accountId=a.id;report.accountId=accountId;scope={accountId,ownerKey:run};claimKey=run+':release';
 await sdk.accounts.createExternalAccount(accountId,{external_account:failBank?{object:'bank_account',country:'US',currency:'usd',routing_number:'110000000',account_number:'000222222227',account_holder_name:'BetterStripe Payout QA',account_holder_type:'individual'}:'btok_us_verified',default_for_currency:true},{idempotencyKey:run+':bank'});
 await sdk.balanceSettings.update({payments:{payouts:{schedule:{interval:'weekly',weekly_payout_days:['monday']}}}},{stripeAccount:accountId,idempotencyKey:run+':schedule'});
 const prepared=await bs.payoutPolicy.prepare(ctx,{...scope,operationKey:run+':enable',expectedRevision:-1,mode:'custom',thresholds:[{currency:'usd',amount:1000}],consent:true});assert.equal(prepared.status,'prepared');
 const applied=await bs.payoutPolicy.apply(ctx,{...scope,operationKey:run+':enable'});assert.equal(applied.status,'ready');restoreRevision=applied.operation.revision;
 console.log('Funding QA recipient with one test transfer');
 const transfer=await sdk.transfers.create({amount:1000,currency:'usd',destination:accountId,metadata:{bsRole:'affiliate',payoutReconciliationQA:run}},{idempotencyKey:run+':fund'});transferId=transfer.id;report.transferId=transferId;
 callPath('connect/mutations:upsertTransfer',{stripeTransferId:transferId,destinationAccountId:accountId,amount:1000,currency:'usd',role:'affiliate',status:'paid',metadata:transfer.metadata});
 const funding=await bs.payoutPolicy.transferReceipt(ctx,{accountId,stripeTransferId:transferId});assert.equal(funding.status,'ready');if(funding.status!=='ready')throw Error('Funding receipt not ready');report.funding={totalNet:funding.totalNet,matureNet:funding.matureNet,pendingCredits:funding.pendingCredits};assert.equal(funding.matureNet,1000);
 const row=callPath('connect/queries:getTransferByStripeId',{stripeTransferId:transferId});const balance=await sdk.balance.retrieve(undefined,{stripeAccount:accountId});const available=balance.available.find(b=>b.currency==='usd')?.amount??0;assert(available>=1000);
 const claim=callPath('payoutRelease/mutations:claim',{...scope,operationKey:claimKey,expectedRevision:restoreRevision,currency:'usd',providerAvailable:available,independentLiabilities:0,observations:[{stripeTransferId:transferId,currency:funding.settlementCurrency,matureNet:funding.matureNet,pendingCredits:funding.pendingCredits,ledgerFingerprint:transferFingerprint(row),observedAt:funding.observedAt,transactionIds:funding.transactions.map(t=>t.id)}]});assert.equal(claim.status,'reserved');assert.equal(claim.amount,1000);
 callPath('payoutRelease/mutations:beginAttempt',{...scope,operationKey:claimKey});
 console.log('Creating exactly one package payout, then simulating recording failure');createAttempted=true;
 const created=await bs.createPayout(ctx,{stripeAccountId:accountId,amount:1000,currency:'usd',metadata:{bsPayoutClaim:claimKey},idempotencyKey:run+':payout'});payoutId=created.stripePayoutId;report.payoutId=payoutId;
 failRecording=true;let outageObserved=false;for(let i=0;i<4&&!outageObserved;i++){try{const state=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey});assert.equal(state.status,'held');await new Promise(r=>setTimeout(r,1500));}catch(error:any){if(error.message==='simulated recording outage')outageObserved=true;else throw error;}}assert(outageObserved);
 assert.equal(callPath('payoutRelease/queries:get',{...scope,operationKey:claimKey}).status,'reserved');report.recordingFailureHeld=true;
 let recovered=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey});for(let i=0;failBank&&i<4&&(recovered.status!=='updated'||recovered.receipt.providerStatus!=='failed');i++){await new Promise(r=>setTimeout(r,1500));recovered=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey});}assert.equal(recovered.status,'updated');if(recovered.status!=='updated')throw Error('Payout not reconciled');report.recovered={status:recovered.claim.status,amount:recovered.claim.amount,providerFee:recovered.claim.providerFee,receipt:recovered.receipt};
 const replay=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey});assert.equal(replay.status,'updated');assert.equal(payoutCreates,1);report.duplicateReplayCreatedNoPayout=true;
 let current=await sdk.payouts.retrieve(payoutId,{}, {stripeAccount:accountId});report.providerOutcome={status:current.status,failureCode:current.failure_code};if(failBank){assert.equal(current.status,'failed');assert.equal(current.failure_code,'insufficient_funds');assert.equal(recovered.claim.status,'returned');assert.equal(recovered.receipt.returnedPrincipal,1000);}
 if(current.status==='pending'){
  console.log('Canceling pending QA payout to verify actual return');
  try{await sdk.payouts.cancel(payoutId,{}, {stripeAccount:accountId,idempotencyKey:run+':cancel'});}catch(error:any){report.cancelError={code:error.code,message:error.message};}
  let returned=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey});for(let i=0;i<3&&returned.status==='held';i++){await new Promise(r=>setTimeout(r,1500));returned=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey});}assert.equal(returned.status,'updated');if(returned.status==='updated'){report.afterCancellation={status:returned.claim.status,receipt:returned.receipt};assert(['returned','paid'].includes(returned.claim.status));}
 }
 report.payoutCreateCalls=payoutCreates;assert.equal(payoutCreates,1);report.status='passed';
}catch(error:any){report.status='failed';report.error={message:error.message.replace(/sk_(test|live)_[A-Za-z0-9]+/g,'[redacted]'),code:error.code};process.exitCode=1;}
finally{
 console.log('Restoring QA schedule and reconciling cleanup');
 if(accountId){
  try{
   let current=payoutId?await sdk.payouts.retrieve(payoutId,{}, {stripeAccount:accountId}):null;
   if(current&&claimKey){const outcome=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey,stripePayoutId:payoutId});report.cleanupReconciliation=outcome.status;if(outcome.status==='updated')report.finalClaimStatus=outcome.claim.status;}
   const canReverse=!createAttempted||((current?.status==='canceled'||current?.status==='failed')&&report.finalClaimStatus==='returned');
   if(transferId&&canReverse){const t=await sdk.transfers.retrieve(transferId);if(t.amount_reversed<t.amount){await sdk.transfers.createReversal(transferId,{amount:t.amount-t.amount_reversed},{idempotencyKey:run+':return-funding'});callPath('connect/mutations:recordTransferReversal',{stripeTransferId:transferId,reversedAmount:t.amount});}report.testFundingReturned=true;}
  }catch(error:any){report.cleanupFundingError=error.message;}
  try{let policy=await bs.payoutPolicy.get(ctx,scope);if(policy?.status==='changing'){await bs.payoutPolicy.apply(ctx,{...scope,operationKey:policy.operationKey});policy=await bs.payoutPolicy.get(ctx,scope);}if(policy?.mode==='custom'){const p=await bs.payoutPolicy.prepare(ctx,{...scope,operationKey:run+':restore',expectedRevision:policy.revision,mode:'stripe_managed',thresholds:[]});assert.equal(p.status,'prepared');assert.equal((await bs.payoutPolicy.apply(ctx,{...scope,operationKey:run+':restore'})).status,'ready');}report.scheduleRestored=true;}catch(error:any){report.cleanupScheduleError=error.message;}
  try{const payouts=await sdk.payouts.list({limit:10},{stripeAccount:accountId});const remaining=await sdk.balance.retrieve(undefined,{stripeAccount:accountId});if(payouts.data.some(p=>p.status==='pending'||p.status==='in_transit')||[...remaining.available,...remaining.pending].some(b=>b.amount!==0))report.cleanupPending=true;else{await sdk.v2.core.accounts.close(accountId,{applied_configurations:['recipient']},{idempotencyKey:run+':close'});report.accountClosed=true;}}catch(error:any){report.cleanupCloseError=error.message;}
 }
 report.payoutCreateCalls=payoutCreates;writeFileSync('/tmp/payout-reconciliation-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
