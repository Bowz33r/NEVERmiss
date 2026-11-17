const $ = id => document.getElementById(id);
let adminKey = "";
async function request(url, method="GET") {
  const res = await fetch(url, {method, headers: {"x-admin-key": adminKey, "Content-Type":"application/json"}});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function loadPayments(){
  try{
    const rows=await request("/api/admin/payments");
    $("loginMessage").textContent="";
    $("results").classList.remove("hidden");
    $("paymentRows").innerHTML=rows.length?rows.map(p=>`
      <div class="admin-row">
        <div style="min-width:0">
          <b>${esc(p.email)}</b>
          <div class="status">TXID: ${esc(p.txid)}</div>
          <div class="status">Submitted: ${esc(p.submitted_at)} · Status: ${esc(p.status)}</div>
        </div>
        <div class="admin-actions">
          ${p.status==="pending"?`<button class="button approve" data-approve="${p.id}">Approve</button><button class="button reject" data-reject="${p.id}">Reject</button>`:""}
        </div>
      </div>`).join(""):"<p class='muted'>No payment submissions yet.</p>";
    document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=async()=>{
      if(!confirm("Have you independently verified this Bitcoin transaction, amount, destination and confirmations?"))return;
      try{await request(`/api/admin/payments/${b.dataset.approve}/approve`,"POST");await loadPayments();}
      catch(e){alert(e.message);}
    });
    document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=async()=>{
      if(!confirm("Reject this payment submission?"))return;
      try{await request(`/api/admin/payments/${b.dataset.reject}/reject`,"POST");await loadPayments();}
      catch(e){alert(e.message);}
    });
  }catch(e){$("loginMessage").textContent=e.message;$("loginMessage").style.color="#b42318";}
}
$("load").onclick=()=>{adminKey=$("adminKey").value;loadPayments();};
$("refresh").onclick=loadPayments;
