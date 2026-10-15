import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {componentsGeneric} from 'convex/server';



const root=process.env.BETTER_STRIPE_REPO_ROOT??process.cwd(); const cwd=root+'/example';
const {BetterStripe}=await import(root+'/src/client/index.ts');
const {getStripeClient}=await import(root+'/src/client/helpers.ts');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key);const bs=new BetterStripe(componentsGeneric().betterStripe as never,{STRIPE_SECRET_KEY:key});
const failBank=process.env.BETTER_STRIPE_QA_BANK_FAILURE==='1';
const run='payout-qualification-qa-'+crypto.randomUUID();
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
 console.log('Funding mixed creator and affiliate sources below and at the threshold');
 const fundingIds:string[]=[];report.fundingIds=fundingIds;
 async function fund(amount:number,role:'store'|'affiliate',tag:string){
  const tr=await sdk.transfers.create({amount,currency:'usd',destination:accountId!,metadata:{bsRole:role,payoutQualificationQA:run}},{idempotencyKey:run+':fund:'+tag});
  fundingIds.push(tr.id);transferId=tr.id;
  callPath('connect/mutations:upsertTransfer',{stripeTransferId:tr.id,destinationAccountId:accountId,amount,currency:'usd',role,status:'paid',metadata:tr.metadata});
 }
 await fund(600,'store','creator');
 const below=await bs.payoutPolicy.release(ctx,{...scope,operationKey:run+':below',currency:'usd',independentLiabilities:0});
 assert.equal(below.status,'held');assert.equal((below as any).reason,'below_threshold');assert.equal(payoutCreates,0);report.below=below;
 await fund(400,'affiliate','affiliate');
 console.log('Public automatic release performs qualification, reservation and creation');createAttempted=true;
 let released=await bs.payoutPolicy.release(ctx,{...scope,operationKey:claimKey!,currency:'usd',independentLiabilities:0});
 for(let i=0;i<6&&(released.status!=='updated'||(failBank&&released.claim.status!=='returned')||(!failBank&&released.claim.status!=='paid'));i++){
  await new Promise(r=>setTimeout(r,1500));released=await bs.payoutPolicy.release(ctx,{...scope,operationKey:claimKey!,currency:'usd',independentLiabilities:0});
 }
 assert.equal(released.status,'updated');if(released.status!=='updated')throw Error('Release did not reconcile');
 payoutId=released.claim.stripePayoutId;report.payoutId=payoutId;
 const recovered=released;report.recovered={status:released.claim.status,amount:released.claim.amount,providerFee:released.claim.providerFee,receipt:released.receipt};
 assert.equal(released.claim.amount,1000);assert.equal(payoutCreates,1);
 const replay=await bs.payoutPolicy.release(ctx,{...scope,operationKey:claimKey!,currency:'usd',independentLiabilities:0});assert.equal(replay.status,'updated');assert.equal(payoutCreates,1);report.duplicateReplayCreatedNoPayout=true;
 if(!failBank){const next=await bs.payoutPolicy.release(ctx,{...scope,operationKey:run+':next',currency:'usd',independentLiabilities:0});assert.equal(next.status,'held');assert.equal((next as any).reason,'below_threshold');report.paidSourceNotReused=next;assert.equal(payoutCreates,1);}
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
   if(canReverse){for(const id of report.fundingIds??[]){const t=await sdk.transfers.retrieve(id);if(t.amount_reversed<t.amount){await sdk.transfers.createReversal(id,{amount:t.amount-t.amount_reversed},{idempotencyKey:run+':return:'+id});callPath('connect/mutations:recordTransferReversal',{stripeTransferId:id,reversedAmount:t.amount});}}report.testFundingReturned=true;}

  }catch(error:any){report.cleanupFundingError=error.message;}
  try{let policy=await bs.payoutPolicy.get(ctx,scope);if(policy?.status==='changing'){await bs.payoutPolicy.apply(ctx,{...scope,operationKey:policy.operationKey});policy=await bs.payoutPolicy.get(ctx,scope);}if(policy?.mode==='custom'){const p=await bs.payoutPolicy.prepare(ctx,{...scope,operationKey:run+':restore',expectedRevision:policy.revision,mode:'stripe_managed',thresholds:[]});assert.equal(p.status,'prepared');assert.equal((await bs.payoutPolicy.apply(ctx,{...scope,operationKey:run+':restore'})).status,'ready');}report.scheduleRestored=true;}catch(error:any){report.cleanupScheduleError=error.message;}
  try{const payouts=await sdk.payouts.list({limit:10},{stripeAccount:accountId});const remaining=await sdk.balance.retrieve(undefined,{stripeAccount:accountId});if(payouts.data.some(p=>p.status==='pending'||p.status==='in_transit')||[...remaining.available,...remaining.pending].some(b=>b.amount!==0))report.cleanupPending=true;else{await sdk.v2.core.accounts.close(accountId,{applied_configurations:['recipient']},{idempotencyKey:run+':close'});report.accountClosed=true;}}catch(error:any){report.cleanupCloseError=error.message;}
 }
 report.payoutCreateCalls=payoutCreates;writeFileSync(process.env.BETTER_STRIPE_QA_REPORT??'/tmp/payout-qualification-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
