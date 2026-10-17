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
$("phoneNumber").addEventListener("input", e => e.target.value = e.target.value.replace(/\D/g,"").slice(0,10));
$("phoneForm").addEventListener("submit", async e => {
  e.preventDefault();
  const phone = $("phoneNumber").value.trim();
  if (!/^[6-9]\d{9}$/.test(phone)) return toast("Enter a valid 10-digit Indian mobile number.");
  currentPhone = "+91" + phone;
  const button = e.submitter; button.disabled = true; button.textContent = "Sending OTP...";
  try {
    const result = await api("/api/auth/send-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({phone:currentPhone}) });
    $("phoneForm").classList.add("d-none"); $("otpForm").classList.remove("d-none"); $("otpCode").focus();
    toast(result.message || "OTP sent by SMS.");
  } catch (err) { toast(err.message); }
  finally { button.disabled = false; button.textContent = "Send OTP →"; }
});
$("otpForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("otpCode").value.trim();
  if (!/^\d{4,10}$/.test(code)) return toast("Enter the OTP you received by SMS.");
  const button = e.submitter; button.disabled = true; button.textContent = "Verifying...";
  try {
    const result = await api("/api/auth/verify-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({phone:currentPhone, code}) });
    authToken = result.token; localStorage.setItem("vc_token", authToken);
    showApp(); await refreshSnapshot(); toast("Mobile number verified.");
  } catch (err) { toast(err.message); }
  finally { button.disabled = false; button.textContent = "Verify & Continue"; }
});
$("resendOtp").addEventListener("click", async () => {
  try {
    const result = await api("/api/auth/send-otp", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({phone:currentPhone}) });
    toast(result.message || "A new OTP was sent.");
  } catch (err) { toast(err.message); }
});
$("backToPhone").addEventListener("click", () => {
  $("otpForm").classList.add("d-none"); $("phoneForm").classList.remove("d-none"); $("otpCode").value = "";
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
