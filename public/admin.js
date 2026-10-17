
let adminToken = "";
const $ = (id) => document.getElementById(id);

function notify(message) {
  $("adminToastMessage").textContent = message;
  bootstrap.Toast.getOrCreateInstance($("adminToast"), {
    delay: 3500
  }).show();
}

// Handles JSON API requests and CSV responses.
async function adminApi(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${adminToken}`
  };

  const response = await fetch(url, { ...options, headers });
  const type = response.headers.get("content-type") || "";

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (_) {}
    throw new Error(message);
  }

  // Return the raw Response for CSV downloads.
  if (type.includes("text/csv")) return response;

  return response.json();
}

// Login
$("adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("adminLoginError").textContent = "";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("adminUsername").value,
        password: $("adminPassword").value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }

    adminToken = data.token;
    $("adminLogin").classList.add("d-none");
    $("adminApp").classList.remove("d-none");

    await loadAdmin();
  } catch (err) {
    $("adminLoginError").textContent = err.message;
  }
});

// Fetch proof as a binary image, NOT JSON.
async function openProof(proofUrl) {
  if (!proofUrl) {
    throw new Error("Proof URL is missing");
  }

  const response = await fetch(proofUrl, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });

  if (!response.ok) {
    let message = `Unable to load proof (${response.status})`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (_) {}
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const openedWindow = window.open(objectUrl, "_blank");

  if (!openedWindow) {
    // Allow the admin to open the proof if popups are blocked.
    const link = document.createElement("a");
    link.href = objectUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open uploaded proof";
    link.style.cssText =
      "display:block;padding:16px;font-size:18px;";
    document.body.appendChild(link);
    notify("Popup blocked. Click the Open uploaded proof link.");
  }

  // Keep the object URL alive while the image is being viewed.
  // The URL is revoked when the page is closed or refreshed.
}

// Load submissions and summary
async function loadAdmin() {
  try {
    const [submissionData, summary] = await Promise.all([
      adminApi("/api/admin/submissions"),
      adminApi("/api/admin/summary")
    ]);

    $("statUsers").textContent = summary.users;
    $("statPending").textContent = summary.pending;
    $("statApproved").textContent = summary.approved;
    $("statEligible").textContent = summary.eligible;

    const body = $("submissionsBody");
    body.replaceChildren();

    if (!submissionData.submissions.length) {
      body.innerHTML =
        '<tr><td colspan="7">No submissions yet.</td></tr>';
      return;
    }

    submissionData.submissions.forEach((item) => {
      const tr = document.createElement("tr");

      const details = item.task_type === "purchase"
        ? `Bill: ${item.bill_number || "-"}<br>Amount: ₹${item.purchase_amount || 0}`
        : item.file_name || "Uploaded proof";

      const status = item.status +
        (item.rejection_reason
          ? ` — ${item.rejection_reason}`
          : "");

      tr.innerHTML = `
        <td>${item.id}</td>
        <td></td>
        <td></td>
        <td>
          <button type="button"
            class="btn btn-outline-silver btn-sm proof-btn">
            View proof
          </button>
        </td>
        <td></td>
        <td></td>
        <td></td>
      `;

      tr.children[1].textContent = item.phone || "";
      tr.children[2].textContent = item.task_type || "";
      tr.children[4].innerHTML = details;
      tr.children[5].textContent = status;

      tr.querySelector(".proof-btn").addEventListener(
        "click",
        async () => {
          try {
            await openProof(item.proofUrl);
          } catch (err) {
            notify(err.message);
          }
        }
      );

      const actions = tr.children[6];

      if (item.status === "pending") {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className =
          "btn btn-silver btn-sm me-1 mb-1";
        approve.textContent = "Approve";

        const reject = document.createElement("button");
        reject.type = "button";
        reject.className =
          "btn btn-outline-silver btn-sm mb-1";
        reject.textContent = "Reject";

        approve.addEventListener("click", () => {
          review(item.id, "approved");
        });

        reject.addEventListener("click", () => {
          const reason = prompt(
            "Reason for rejection (required):"
          );

          if (reason && reason.trim()) {
            review(item.id, "rejected", reason.trim());
          }
        });

        actions.append(approve, reject);
      } else {
        actions.textContent = "Reviewed";
      }

      body.appendChild(tr);
    });
  } catch (err) {
    notify(err.message);
  }
}

// Approve or reject a submission
async function review(id, status, reason = "") {
  try {
    const result = await adminApi(
      `/api/admin/submissions/${id}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason })
      }
    );

    notify(result.message || "Submission updated");
    await loadAdmin();
  } catch (err) {
    notify(err.message);
  }
}

// Refresh dashboard
$("refreshAdmin").addEventListener("click", loadAdmin);

// Export eligible participants as CSV
$("exportBtn").addEventListener("click", async () => {
  let objectUrl;

  try {
    const response = await adminApi("/api/admin/eligible.csv");
    const blob = await response.blob();

    objectUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "vcreation-eligible-participants.csv";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    notify(err.message);
  }
});

// Logout
$("adminLogout").addEventListener("click", () => {
  adminToken = "";
  $("adminApp").classList.add("d-none");
  $("adminLogin").classList.remove("d-none");
});
