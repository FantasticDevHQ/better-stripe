import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {componentsGeneric} from 'convex/server';



const root=process.env.BETTER_STRIPE_REPO_ROOT??process.cwd();const cwd=root+'/example';
const {BetterStripe}=await import(root+'/src/client/index.ts');
const {getStripeClient}=await import(root+'/src/client/helpers.ts');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key);const bs=new BetterStripe(componentsGeneric().betterStripe as never,{STRIPE_SECRET_KEY:key});
const failBank=process.env.BETTER_STRIPE_QA_BANK_FAILURE==='1';
const run='payout-adoption-qa-'+crypto.randomUUID();
const report:any={scenario:'historical_import_and_later_refund',sandbox:true,publicPackage:true,realProvider:true,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),run};
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
 const prepared=await bs.payoutPolicy.prepare(ctx,{...scope,operationKey:run+':enable',expectedRevision:-1,mode:'stripe_managed',thresholds:[]});assert.equal(prepared.status,'prepared');
 const applied=await bs.payoutPolicy.apply(ctx,{...scope,operationKey:run+':enable'});assert.equal(applied.status,'ready');restoreRevision=applied.operation.revision;

 let capabilityStatus:string|undefined;
 for(let i=0;i<15;i++){
  const current=await sdk.v2.core.accounts.retrieve(accountId!,{include:['configuration.recipient']});
  capabilityStatus=current.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  if(capabilityStatus==='active')break;
  if(['rejected','restricted','unsupported'].includes(capabilityStatus??''))throw Error('QA recipient transfer capability '+capabilityStatus);
  await new Promise(r=>setTimeout(r,1500));
 }
 report.transferCapability=capabilityStatus;assert.equal(capabilityStatus,'active');
 const funds:{id:string,amount:number,role:string}[]=[];report.funding=funds;
 async function fund(amount:number,role:'store'|'affiliate',tag:string){
  const t=await sdk.transfers.create({amount,currency:'usd',destination:accountId!,metadata:{bsRole:role,historicalQA:run}},{idempotencyKey:run+':fund:'+tag});
  funds.push({id:t.id,amount,role});callPath('connect/mutations:upsertTransfer',{stripeTransferId:t.id,destinationAccountId:accountId,amount,currency:'usd',role,status:'paid',metadata:t.metadata});return t.id;
 }
 await fund(600,'store','creator');await fund(400,'affiliate','affiliate');
 console.log('Creating one historical manual sandbox payout without a BetterStripe claim');createAttempted=true;
 const created=await bs.createPayout(ctx,{stripeAccountId:accountId!,amount:1000,currency:'usd',metadata:{historicalQA:run},idempotencyKey:run+':historic-payout'});payoutId=created.stripePayoutId;claimKey='bs:historical:'+payoutId;report.payoutId=payoutId;
 let receipt=await bs.payoutPolicy.payoutReceipt({accountId:accountId!,stripePayoutId:payoutId});
 for(let i=0;i<6&&(receipt.status!=='ready'||receipt.providerStatus!=='paid');i++){await new Promise(r=>setTimeout(r,1500));receipt=await bs.payoutPolicy.payoutReceipt({accountId:accountId!,stripePayoutId:payoutId});}
 assert.equal(receipt.status,'ready');if(receipt.status!=='ready')throw Error('Historical payout receipt unavailable');assert.equal(receipt.providerStatus,'paid');report.originalPayoutReceipt=receipt;
 const options={...scope,currency:'usd',expectedRevision:restoreRevision!,payouts:[{stripePayoutId:payoutId,allocations:funds.map(t=>({stripeTransferId:t.id,amount:t.amount}))}]};
 console.log('Importing and replaying explicit historical source allocations');
 const adopted=await bs.payoutPolicy.adoptPayouts(ctx,options);assert.equal(adopted.status,'adopted');if(adopted.status!=='adopted')throw Error('Historical adoption held: '+adopted.reason);assert.equal(adopted.claims.length,1);assert.equal(adopted.claims[0].historical,true);assert.equal(adopted.claims[0].status,'paid');report.adopted=adopted;
 const replay=await bs.payoutPolicy.adoptPayouts(ctx,options);assert.equal(replay.status,'adopted');assert.equal(payoutCreates,1);report.replayDidNotCreatePayout=true;
 const later=await fund(300,'store','later');report.laterTransferId=later;
 const reversal=await sdk.transfers.createReversal(funds[1].id,{amount:100},{idempotencyKey:run+':later-refund'});callPath('connect/mutations:recordTransferReversal',{stripeTransferId:funds[1].id,reversedAmount:100});report.refundReversalId=reversal.id;
 console.log('Rechecking historical funding after a later refund; paid principal must remain recorded');
 const after=await bs.payoutPolicy.adoptPayouts(ctx,{...options,payouts:[]});assert.equal(after.status,'adopted');if(after.status!=='adopted')throw Error('Post-refund history held: '+after.reason);assert.equal(after.claims[0].amount,1000);assert.equal(after.claims[0].allocations.reduce((a,t)=>a+t.amount,0),1000);report.afterRefund=after;
 let mature=0;
 for(const t of funds){const r=await bs.payoutPolicy.transferReceipt(ctx,{accountId:accountId!,stripeTransferId:t.id});assert.equal(r.status,'ready');if(r.status!=='ready')throw Error('Current source receipt held');mature+=r.matureNet;}
 const balance=await sdk.balance.retrieve(undefined,{stripeAccount:accountId});const available=balance.available.find(v=>v.currency==='usd')?.amount??0;
 report.currentFunding={matureReceived:mature,historicalPaid:1000,unpaidAfterRefund:mature-1000,providerAvailable:available};assert.equal(mature-1000,200);assert.equal(available,200);assert.equal(payoutCreates,1);report.status='passed';
}catch(error:any){report.status='failed';report.error={message:error.message.replace(/sk_(test|live)_[A-Za-z0-9]+/g,'[redacted]'),code:error.code};process.exitCode=1;}
finally{
 console.log('Reconciling historical claim and returning remaining QA funds');
 if(accountId){
  try{
   if(payoutId&&claimKey){const claim=callPath('payoutRelease/queries:get',{...scope,operationKey:claimKey});if(claim){const state=await bs.payoutPolicy.reconcilePayout(ctx,{...scope,operationKey:claimKey,stripePayoutId:payoutId});report.finalClaimStatus=state.status==='updated'?state.claim.status:state.status;}}
   const balance=await sdk.balance.retrieve(undefined,{stripeAccount:accountId});let available=balance.available.find(v=>v.currency==='usd')?.amount??0;
   // Never reverse money already paid to the bank. Recover only remaining cash.
   for(const t of [...(report.funding??[])].reverse()){if(available<=0)break;const original=await sdk.transfers.retrieve(t.id);const amount=Math.min(available,original.amount-original.amount_reversed);if(amount>0){await sdk.transfers.createReversal(t.id,{amount},{idempotencyKey:run+':cleanup:'+t.id});callPath('connect/mutations:recordTransferReversal',{stripeTransferId:t.id,reversedAmount:original.amount_reversed+amount});available-=amount;}}
   report.remainingTestCashReturned=true;
  }catch(error:any){report.cleanupFundingError=error.message;}
  try{const policy=await bs.payoutPolicy.get(ctx,scope);assert.equal(policy?.mode,'stripe_managed');const settings=await sdk.balanceSettings.retrieve(undefined,{stripeAccount:accountId});assert.equal(settings.payments.payouts?.schedule.interval,'weekly');report.schedulePreserved=true;}catch(error:any){report.cleanupScheduleError=error.message;}
  try{const balance=await sdk.balance.retrieve(undefined,{stripeAccount:accountId});const payouts=await sdk.payouts.list({limit:10},{stripeAccount:accountId});if([...balance.available,...balance.pending].some(v=>v.amount!==0)||payouts.data.some(p=>p.status==='pending'||p.status==='in_transit'))report.cleanupPending=true;else{await sdk.v2.core.accounts.close(accountId,{applied_configurations:['recipient']},{idempotencyKey:run+':close'});report.accountClosed=true;}}catch(error:any){report.cleanupCloseError=error.message;}
 }
 report.payoutCreateCalls=payoutCreates;writeFileSync('/tmp/payout-adoption-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
