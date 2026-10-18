let authToken = localStorage.getItem("vc_token") || "";
let currentPhone = "";
let appConfig = { whatsappUrl: "#", instagramUrl: "https://www.instagram.com/v_creation_aundipatti_?xtok=cXhud29ybXl4enR5", minimumPurchase: 1000 };
const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function toast(message) {
  $("toastMessage").textContent = message;
  bootstrap.Toast.getOrCreateInstance($("appToast"), { delay: 3800 }).show();
}
function showApp() {
  $("loginView").classList.add("d-none");
  $("appView").classList.remove("d-none");
  $("userPhone").textContent = currentPhone;
  window.scrollTo({top:0, behavior:"smooth"});
}
function showLogin() {
  $("appView").classList.add("d-none");
  $("loginView").classList.remove("d-none");
}
function statusText(task) {
  if (!task) return ["Not submitted", ""];
  if (task.status === "approved") return ["Approved", "approved"];
  if (task.status === "rejected") return [`Rejected: ${task.rejectionReason || "Please submit new proof."}`, "rejected"];
  return ["Pending admin review", "pending"];
}
function renderSnapshot(snapshot) {
  const tasks = snapshot.tasks || {};
  let approved = 0, pending = 0, rejected = 0;
  ["whatsapp","instagram","purchase"].forEach(key => {
    const el = $(key + "Status");
    const [text, cls] = statusText(tasks[key]);
    if (tasks[key]?.status === "approved") approved++;
    if (tasks[key]?.status === "pending") pending++;
    if (tasks[key]?.status === "rejected") rejected++;
    el.className = "task-status " + cls;
    el.innerHTML = `<span class="status-dot"></span><span></span>`;
    el.querySelector("span:last-child").textContent = text;
  });
  $("progressText").textContent = `${approved} of 3 approved`;
  $("progressBar").style.width = `${approved / 3 * 100}%`;
  $("billAmount").min = snapshot.minimumPurchase || 1000;
  $("billAmount").placeholder = `Minimum ₹${snapshot.minimumPurchase || 1000}`;
  $("eligibilityCard").classList.toggle("eligible", !!snapshot.eligible);
  $("eligibilityIcon").textContent = snapshot.eligible ? "✓" : "✦";
  $("eligibilityTitle").textContent = snapshot.eligible ? "You're eligible for the giveaway!" : pending ? "Waiting for verification" : rejected ? "Action required" : "Your entry is in progress";
  $("eligibilityDescription").textContent = snapshot.eligible
    ? "All three tasks have been approved. Your entry is confirmed."
    : "Complete all three steps and wait for admin verification. You become eligible only after every task is approved.";
  $("eligibilityPill").textContent = snapshot.eligible ? "ELIGIBLE" : pending ? "PENDING REVIEW" : rejected ? "ACTION REQUIRED" : "IN PROGRESS";
  $("participantId").classList.toggle("d-none", !snapshot.eligible);
  $("participantId").textContent = snapshot.eligible ? `PARTICIPANT ID: ${snapshot.entryCode}` : "";
}
async function refreshSnapshot() {
  const snapshot = await api("/api/me");
  currentPhone = snapshot.user.phone;
  $("userPhone").textContent = currentPhone;
  renderSnapshot(snapshot);
}
async function loadConfig() {
  try {
    appConfig = await api("/api/config");
    $("instagramLink").href = appConfig.instagramUrl;
    $("whatsappLink").href = appConfig.whatsappUrl;
  } catch (_) {}
}
let authMode = "login";
function setAuthMode(mode) {
 authMode=mode; const registering=mode==="register";
 $("showLoginTab").classList.toggle("active",!registering); $("showRegisterTab").classList.toggle("active",registering);
 $("showLoginTab").setAttribute("aria-selected",String(!registering)); $("showRegisterTab").setAttribute("aria-selected",String(registering));
 $("nameField").classList.toggle("d-none",!registering); $("confirmPasswordField").classList.toggle("d-none",!registering);
 $("fullName").required=registering; $("confirmPassword").required=registering;
 $("accountPassword").autocomplete=registering?"new-password":"current-password";
 $("authSubmit").textContent=registering?"Create account →":"Log in →";
}
$("showLoginTab").addEventListener("click",()=>setAuthMode("login"));
$("showRegisterTab").addEventListener("click",()=>setAuthMode("register"));
$("phoneNumber").addEventListener("input",e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,10));
$("authForm").addEventListener("submit",async e=>{
 e.preventDefault(); const phone=$("phoneNumber").value.trim(), password=$("accountPassword").value, name=$("fullName").value.trim();
 if(!/^[6-9]\d{9}$/.test(phone)) return toast("Enter a valid 10-digit Indian mobile number.");
 if(password.length<8) return toast("Use a password with at least 8 characters.");
 if(authMode==="register"&&name.length<2) return toast("Enter your full name.");
 if(authMode==="register"&&password!==$("confirmPassword").value) return toast("Passwords do not match.");
 const button=$("authSubmit"); button.disabled=true; button.textContent=authMode==="register"?"Creating account...":"Logging in...";
 try {
  const endpoint=authMode==="register"?"/api/auth/register":"/api/auth/login";
  const payload=authMode==="register"?{phone:"+91"+phone,password,name}:{phone:"+91"+phone,password};
  const result=await api(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  authToken=result.token; localStorage.setItem("vc_token",authToken); currentPhone=result.user?.phone||"+91"+phone;
  showApp(); await refreshSnapshot(); toast(authMode==="register"?"Account created successfully.":"Welcome back!");
 } catch(err){toast(err.message)} finally{button.disabled=false;setAuthMode(authMode)}
});
$("logoutBtn").addEventListener("click", () => {
  authToken = ""; localStorage.removeItem("vc_token"); currentPhone = ""; showLogin(); toast("You have logged out.");
});
$("year").textContent = new Date().getFullYear();
document.querySelectorAll(".file-input").forEach(input => input.addEventListener("change", () => {
  const file = input.files?.[0];
  const nameId = input.id === "whatsappFile" ? "whatsappFileName" : input.id === "instagramFile" ? "instagramFileName" : "purchaseFileName";
  if (!file) { $(nameId).textContent = "No file selected"; return; }
  if (file.size > 5 * 1024 * 1024) { input.value = ""; $(nameId).textContent = "No file selected"; return toast("Image must be 5 MB or smaller."); }
  $(nameId).textContent = file.name;
}));
document.querySelectorAll(".submit-task").forEach(button => button.addEventListener("click", async () => {
  if (!authToken) return toast("Please verify your mobile number first.");
  const task = button.dataset.task;
  const input = $(task === "purchase" ? "purchaseFile" : task + "File");
  if (!input.files?.[0]) return toast("Please select a screenshot or bill image.");
  const form = new FormData(); form.append("proof", input.files[0]);
  if (task === "purchase") {
    form.append("billNumber", $("billNumber").value.trim());
    form.append("purchaseAmount", $("billAmount").value);
  }
  button.disabled = true; const oldText = button.textContent; button.textContent = "Submitting...";
  try {
    const result = await api(`/api/tasks/${task}`, { method:"POST", body:form });
    renderSnapshot(result.snapshot); input.value = "";
    $(task === "purchase" ? "purchaseFileName" : task + "FileName").textContent = "No file selected";
    toast(result.message);
  } catch (err) { toast(err.message); }
  finally { button.disabled = false; button.textContent = oldText; }
}));
async function init() {
  await loadConfig();
  if (authToken) {
    try { showApp(); await refreshSnapshot(); }
    catch (_) { authToken = ""; localStorage.removeItem("vc_token"); showLogin(); }
  }
}
init();
