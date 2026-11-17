const $ = id => document.getElementById(id);
let mode = "register";
let me = null;
let config = null;

async function api(url, options={}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type":"application/json", ...(options.headers||{}) } });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function show(id){ $(id).classList.remove("hidden"); }
function hide(id){ $(id).classList.add("hidden"); }
function message(id, text, bad=false){ const el=$(id); el.textContent=text; el.style.color=bad?"#b42318":"#16825b"; }
function openAuth(){ mode="register"; updateAuthMode(); show("authModal"); }
function updateAuthMode(){
  $("authTitle").textContent=mode==="register"?"Create your account":"Welcome back";
  $("authSubmit").textContent=mode==="register"?"Create account":"Sign in";
  $("authSwitch").innerHTML=mode==="register"?'Already registered? <a href="#" id="switchAuth">Sign in</a>':'New to NeverMiss? <a href="#" id="switchAuth">Create an account</a>';
  $("password").autocomplete=mode==="register"?"new-password":"current-password";
  $("switchAuth").onclick=e=>{e.preventDefault();mode=mode==="register"?"login":"register";updateAuthMode();};
}
async function openApp(){
  try {
    const data=await api("/api/me");
    me=data.user;
    if(!me){openAuth();return;}
    $("userEmail").textContent=me.email;
    hide("authModal");show("appModal");
    config=await api("/api/config");
    $("wallet").textContent=config.bitcoinAddress;
    const active=me.subscription_status==="active" && me.subscription_expires_at && new Date(me.subscription_expires_at)>new Date();
    if(active){
      $("subscriptionBox").innerHTML=`<b>✓ Membership active</b><p class="muted">Your access expires ${new Date(me.subscription_expires_at).toLocaleDateString()}.</p>`;
      hide("paymentBox");show("reminderArea");await loadReminders();
    } else {
      $("subscriptionBox").innerHTML="<b>Membership not active</b><p class='muted'>Submit your annual payment transaction ID below. Access is enabled after manual verification.</p>";
      show("paymentBox");hide("reminderArea");await loadPaymentStatus();
    }
  } catch(e){alert(e.message);}
}
async function loadReminders(){
  const rows=await api("/api/reminders");
  $("reminderList").innerHTML=rows.length?rows.map(r=>`<div class="deadline"><div><b>${escapeHtml(r.title)}</b><small>${escapeHtml(r.category)} · Due ${escapeHtml(r.due_date)}${r.notes?" · "+escapeHtml(r.notes):""}</small></div><button class="delete" data-delete="${r.id}">Delete</button></div>`).join(""):"<p class='muted'>No deadlines yet. Add your first one above.</p>";
  document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("Delete this deadline?")){await api("/api/reminders/"+b.dataset.delete,{method:"DELETE"});loadReminders();}});
}
async function loadPaymentStatus(){
  const data=await api("/api/payment-status");
  if(data.payments.length) message("paymentMessage","Latest payment status: "+data.payments[0].status+". We will activate your account after verifying the transaction.");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$("year").textContent=new Date().getFullYear();
$("accountBtn").onclick=openApp;
$("startBtn").onclick=openAuth;
$("priceBtn").onclick=openAuth;
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>{hide("authModal");hide("appModal");});
$("authForm").onsubmit=async e=>{
  e.preventDefault();message("authMessage","");
  try{
    const data=await api(mode==="register"?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})});
    me=data.user;hide("authModal");await openApp();
  }catch(err){message("authMessage",err.message,true);}
};
$("logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});me=null;hide("appModal");};
$("copyWallet").onclick=async()=>{await navigator.clipboard.writeText(config.bitcoinAddress);message("paymentMessage","Bitcoin address copied.");};
$("submitPayment").onclick=async()=>{
  try{const data=await api("/api/payments",{method:"POST",body:JSON.stringify({txid:$("txid").value})});message("paymentMessage",data.message);$("txid").value="";}
  catch(e){message("paymentMessage",e.message,true);}
};
$("reminderForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    await api("/api/reminders",{method:"POST",body:JSON.stringify({title:$("title").value,due_date:$("dueDate").value,category:$("category").value,notes:$("notes").value})});
    e.target.reset();await loadReminders();
  }catch(err){alert(err.message);}
};
