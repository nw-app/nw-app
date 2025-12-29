import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";
import { initializeFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, setLogLevel, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJKCa2QtJXLiXPsy0P7He_yuZEN__iQ6E",
  authDomain: "nw-app-all.firebaseapp.com",
  projectId: "nw-app-all",
  storageBucket: "nw-app-all.firebasestorage.app",
  messagingSenderId: "205108931232",
  appId: "1:205108931232:web:ee7868f73ed883253577c5",
  measurementId: "G-8F1WD772LP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});
const storage = getStorage(app);
setLogLevel("silent");
// Secondary app for admin account creation to avoid switching current session
const createApp = initializeApp(firebaseConfig, "create-admin");
const createAuth = getAuth(createApp);

const communityConfigs = {
  default: firebaseConfig
};
const tenantApps = {};
function ensureTenant(slug) {
  const key = slug || "default";
  const cfg = communityConfigs[key] || communityConfigs.default;
  if (!tenantApps[key]) {
    const tapp = initializeApp(cfg, "tenant-" + key);
    tenantApps[key] = {
      app: tapp,
      db: initializeFirestore(tapp, {
        experimentalForceLongPolling: true,
        useFetchStreams: false
      }),
      storage: getStorage(tapp)
    };
  }
  return tenantApps[key];
}
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}
function getSlugFromPath() {
  try {
    const p = window.location.pathname;
    const m = p.match(/(?:front|admin)_([^.]+)\.html$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function ensureQrLib() {
  if (window.QRCode && window.QRCode.toDataURL) return;
  if (window._qrLibLoading) return window._qrLibLoading;
  window._qrLibLoading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  await window._qrLibLoading;
}

async function ensureXlsxLib() {
  if (window.XLSX) return;
  if (window._xlsxLibLoading) return window._xlsxLibLoading;
  const sources = [
    'https://cdn.jsdelivr.net/npm/xlsx@0.20.2/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.20.2/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.20.2/xlsx.full.min.js'
  ];
  window._xlsxLibLoading = new Promise((resolve) => {
    let idx = 0;
    const tryLoad = () => {
      if (window.XLSX) return resolve();
      if (idx >= sources.length) return resolve();
      const s = document.createElement('script');
      s.src = sources[idx++];
      s.onload = () => resolve();
      s.onerror = () => tryLoad();
      document.head.appendChild(s);
      setTimeout(() => {
        if (!window.XLSX) tryLoad();
      }, 5000);
    };
    tryLoad();
  });
  await window._xlsxLibLoading;
}

async function getQrDataUrl(text, size) {
  try {
    await ensureQrLib();
    if (window.QRCode && window.QRCode.toDataURL) {
      return await window.QRCode.toDataURL(text, { width: size || 64, margin: 0 });
    }
  } catch {}
  const safe = (text || "").replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size||64}' height='${size||64}'><rect width='100%' height='100%' fill='#ffffff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='10' fill='#111'>${safe}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function checkPagePermission(role, path) {
  const p = path || window.location.pathname;
  if (p.includes("sys")) {
    return role === "系統管理員";
  } else if (p.includes("admin")) {
    return role === "系統管理員" || role === "管理員" || role === "總幹事";
  } else if (p.includes("front")) {
    return role === "系統管理員" || role === "住戶";
  }
  return true;
}
async function getUserCommunity(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const d = snap.data();
      return d.community || "default";
    }
  } catch {}
  return "default";
}

const el = {
  authCard: document.getElementById("auth-card"),
  profileCard: document.getElementById("profile-card"),
  hint: document.getElementById("auth-hint"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  btnLogin: document.getElementById("btn-login"),
  btnRegister: document.getElementById("btn-register"),
  btnReset: document.getElementById("btn-reset"),
  btnSignout: document.getElementById("btn-signout"),
  profileEmail: document.getElementById("profile-email"),
  profileRole: document.getElementById("profile-role"),
};

const brand = document.querySelector(".brand-logo");
let lastTap = 0;
if (brand) {
  brand.addEventListener("dblclick", () => {
    location.href = "admin.html";
  });
  brand.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 300) {
      location.href = "admin.html";
    }
    lastTap = now;
  }, { passive: true });
}

const frontStack = document.getElementById("front-stack");
const adminStack = document.getElementById("admin-stack");
const sysStack = document.getElementById("sys-stack");
const mainContainer = document.querySelector("main.container");
const btnSignoutFront = document.getElementById("btn-signout-front");
const btnSignoutAdmin = document.getElementById("btn-signout-admin");
const btnSignoutSys = document.getElementById("btn-signout-sys");
const btnAdminSecret = document.getElementById("btn-admin-secret");
const rememberMe = document.getElementById("remember-me");
const btnTogglePassword = document.getElementById("btn-toggle-password");

if (btnAdminSecret) {
  btnAdminSecret.addEventListener("click", () => {
    location.href = "sys.html";
  });
}

window.addEventListener('offline', () => {
  showHint("網路已斷線，請檢查您的網際網路連線", "error");
});
window.addEventListener('online', () => {
  showHint("網路已恢復連線", "success");
});

function openModal(html) {
  let root = document.getElementById("sys-modal");
  if (!root) {
    root = document.createElement("div");
    root.id = "sys-modal";
    root.className = "modal hidden";
    document.body.appendChild(root);
  }
  root.innerHTML = html;
  root.classList.remove("hidden");
}
function closeModal() {
  const root = document.getElementById("sys-modal");
  if (!root) return;
  root.classList.add("hidden");
  root.innerHTML = "";
}
async function openUserProfileModal() {
  const u = auth.currentUser;
  const title = "個人資訊";
  const email = (u && u.email) || "";
  let name = (u && u.displayName) || "";
  let photo = (u && u.photoURL) || "";
  let phone = "";
  let status = "啟用";
  let role = "住戶";
  if (u) {
    try {
      const snap = await getDoc(doc(db, "users", u.uid));
      if (snap.exists()) {
        const d = snap.data();
        name = name || d.displayName || "";
        photo = photo || d.photoURL || "";
        phone = d.phone || "";
        status = d.status || status;
        role = d.role || role;
      }
    } catch {}
  }
  const body = `
    <div class="modal-dialog">
      <div class="modal-head"><div class="modal-title">${title}</div></div>
      <div class="modal-body">
        <div class="modal-row">
          <label>大頭照</label>
          <img class="avatar-preview" src="${photo || ""}">
        </div>
        <div class="modal-row">
          <label>姓名</label>
          <input type="text" value="${name || ""}" disabled>
        </div>
        <div class="modal-row">
          <label>電子郵件</label>
          <input type="text" value="${email}" disabled>
        </div>
        <div class="modal-row">
          <label>手機號碼</label>
          <input type="text" value="${phone}" disabled>
        </div>
        <div class="modal-row">
          <label>角色</label>
          <input type="text" value="${role}" disabled>
        </div>
        <div class="modal-row">
          <label>狀態</label>
          <input type="text" value="${status}" disabled>
        </div>
      </div>
      <div class="modal-foot">
        <button id="profile-close" class="btn action-btn danger">關閉</button>
        <button id="profile-signout" class="btn action-btn">登出</button>
      </div>
    </div>
  `;
  openModal(body);
  const btnClose = document.getElementById("profile-close");
  const btnSignout = document.getElementById("profile-signout");
  btnClose && btnClose.addEventListener("click", () => closeModal());
  btnSignout && btnSignout.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } finally {
      redirectAfterSignOut();
    }
  });
}

function showHint(text, type = "info") {
  el.hint.textContent = text;
  el.hint.style.color = type === "error" ? "#b71c1c" : type === "success" ? "#0ea5e9" : "#6b7280";
}

function redirectAfterSignOut() {
  const p = window.location.pathname;
  if (p.includes("sys")) {
    location.href = "sys.html";
  } else if (p.includes("admin")) {
    location.reload();
  } else {
    location.href = "index.html";
  }
}

function toggleAuth(showAuth) {
  if (showAuth) {
    if (el.authCard) el.authCard.classList.remove("hidden");
    el.profileCard && el.profileCard.classList.add("hidden");
    frontStack && frontStack.classList.add("hidden");
    adminStack && adminStack.classList.add("hidden");
    sysStack && sysStack.classList.add("hidden");
    mainContainer && mainContainer.classList.remove("hidden");
  } else {
    if (el.authCard) el.authCard.classList.add("hidden");
    if (el.profileCard) el.profileCard.classList.add("hidden");
  }
}

async function getOrCreateUserRole(uid, email) {
  const ref = doc(db, "users", uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      // Superadmin by email override
      if (email === "nwapp.eason@gmail.com") {
        if (data.role !== "系統管理員") {
          try {
            await setDoc(ref, { role: "系統管理員", status: "啟用" }, { merge: true });
          } catch {}
        }
        return "系統管理員";
      }
      if (data.status === "停用") return "停用";
      return data.role || "住戶";
    }
    try {
      const base = { email, role: email === "nwapp.eason@gmail.com" ? "系統管理員" : "住戶", status: "啟用", createdAt: Date.now() };
      await setDoc(ref, base, { merge: true });
    } catch {}
    return email === "nwapp.eason@gmail.com" ? "系統管理員" : "住戶";
  } catch {
    return email === "nwapp.eason@gmail.com" ? "系統管理員" : "住戶";
  }
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el.email.value.trim();
    const password = el.password.value;
    if (!email || !password) return showHint("請輸入帳號密碼", "error");

    el.btnLogin.disabled = true;
    el.btnLogin.textContent = "登入中...";
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const role = await getOrCreateUserRole(cred.user.uid, cred.user.email);
      if (role === "停用") {
        showHint("帳號已停用，請聯繫管理員", "error");
        await signOut(auth);
        el.btnLogin.disabled = false;
        el.btnLogin.textContent = "登入";
        return;
      }
      showHint("登入成功", "success");
      // Strict Login Check based on Page
      if (!checkPagePermission(role, window.location.pathname)) {
         showHint("權限不足", "error");
         await signOut(auth);
         el.btnLogin.disabled = false;
         el.btnLogin.textContent = "登入";
         // Stay on login page, do not redirect
         return;
      }

      handleRoleRedirect(role);
    } catch (err) {
      console.error(err);
      let msg = "登入失敗";
      if (err.code === 'auth/invalid-credential') msg = "帳號或密碼錯誤";
      else if (err.code === 'auth/too-many-requests') msg = "嘗試次數過多，請稍後再試";
      showHint(msg, "error");
      el.btnLogin.disabled = false;
      el.btnLogin.textContent = "登入";
    }
  });
}

async function handleRoleRedirect(role) {
  if (role === "停用") {
    showHint("帳號已停用，請聯繫管理員", "error");
    await signOut(auth);
    return;
  }
  // Simple role based redirect logic
  if (window.location.pathname.includes("sys")) {
      if (role === "系統管理員") {
        toggleAuth(false);
        if (sysStack) sysStack.classList.remove("hidden");
        if (mainContainer) mainContainer.classList.add("hidden");
      } else {
         showHint("權限不足", "error");
         await signOut(auth);
         // Stay on login page
      }
      return;
  }
  
  async function renderSettingsResidentsLegacy() {
    if (!sysNav.content) return;
    const u = auth.currentUser;
    const slug = u ? await getUserCommunity(u.uid) : "default";
    let cname = slug;
    let loadError = false;
    try {
      const csnap = await getDoc(doc(db, "communities", slug));
      if (csnap.exists()) {
        const c = csnap.data();
        cname = c.name || slug;
      }
    } catch {
      loadError = true;
    }
    let residents = [];
    try {
      const q = query(collection(db, "users"), where("community", "==", slug));
      const snapList = await getDocs(q);
      residents = snapList.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => (a.role || "住戶") === "住戶");
    } catch {
      loadError = true;
    }
    const rows = residents.map(a => {
      const nm = a.displayName || (a.email || "").split("@")[0] || "住戶";
      const av = a.photoURL
        ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
        : `<span class="avatar">${(nm || a.email || "住")[0]}</span>`;
      return `
        <tr data-uid="${a.id}">
          <td class="avatar-cell">${av}</td>
          <td>${nm}</td>
          <td>${a.phone || ""}</td>
          <td>••••••</td>
          <td>${a.email || ""}</td>
          <td>${a.role || "住戶"}</td>
          <td class="status">${a.status || "停用"}</td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-resident">編輯</button>
            <button class="btn small action-btn danger btn-delete-resident">刪除</button>
          </td>
        </tr>
      `;
    }).join("");
    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">住戶帳號列表（${cname}）</h1>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup>
              <col><col><col><col><col><col><col><col>
            </colgroup>
            <thead>
              <tr>
                <th>大頭照</th>
                <th>姓名</th>
                <th>手機號碼</th>
                <th>密碼</th>
                <th>電子郵件</th>
                <th>角色</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${(!rows || rows === "") ? `<div class="empty-hint">${loadError ? "讀取失敗，請重新整理或稍後再試" : "目前沒有住戶資料"}</div>` : ""}
        </div>
      </div>
    `;
    const btnExportLegacy2 = document.getElementById("btn-export-resident");
    btnExportLegacy2 && btnExportLegacy2.addEventListener("click", async () => {
      btnExportLegacy2.disabled = true;
      btnExportLegacy2.textContent = "匯出中...";
      try {
        await ensureXlsxLib();
        if (!window.XLSX) throw new Error("Excel Library not found");
        const data = residents.map((r, idx) => ({
          "大頭照": r.photoURL || "",
          "序號": r.seq || "",
          "戶號": r.houseNo || "",
          "子戶號": r.subNo !== undefined ? r.subNo : "",
          "QR code": r.qrCodeText || "",
          "姓名": r.displayName || "",
          "地址": r.address || "",
          "坪數": r.area || "",
          "區分權比": r.ownershipRatio || "",
          "手機號碼": r.phone || "",
          "電子郵件": r.email || "",
          "狀態": r.status || "啟用"
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
        window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch(e) {
        console.error(e);
        alert("匯出失敗");
      } finally {
        btnExportLegacy2.disabled = false;
        btnExportLegacy2.textContent = "匯出 Excel";
      }
    });

    const btnImportLegacy2 = document.getElementById("btn-import-resident");
    btnImportLegacy2 && btnImportLegacy2.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx, .xls, .csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let overlay = document.getElementById("import-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "import-overlay";
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
          document.body.appendChild(overlay);
        }
        overlay.style.display = "flex";
        overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
        btnImportLegacy2.disabled = true;
        btnImportLegacy2.textContent = "匯入中...";
        try {
          await ensureXlsxLib();
          if (!window.XLSX) throw new Error("Excel Library not found");
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = window.XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
              if (jsonData.length === 0) {
                alert("檔案內容為空");
                overlay.style.display = "none";
                return;
              }
              if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                overlay.style.display = "none";
                return;
              }
              let successCount = 0;
              let failCount = 0;
              const total = jsonData.length;
              const updateProgress = (processed) => {
                 const el = document.getElementById("import-msg");
                 if (el) el.textContent = `匯入中... ${processed} / ${total}`;
              };
              const CHUNK_SIZE = 20; 
              for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                let hasWrites = false;
                const promises = chunk.map(async (row) => {
                    try {
                        const email = (row["電子郵件"] || "").trim();
                        const password = (row["密碼"] || "123456").trim();
                        const displayName = (row["姓名"] || "").trim();
                        const phone = (row["手機號碼"] || "").toString().trim();
                        const seq = (row["序號"] || "").toString().trim();
                        const houseNo = (row["戶號"] || "").toString().trim();
                        const subNoRaw = row["子戶號"];
                        const qrCodeText = (row["QR code"] || "").trim();
                        const address = (row["地址"] || "").trim();
                        const area = (row["坪數"] || "").toString().trim();
                        const ownershipRatio = (row["區分權比"] || "").toString().trim();
                        const status = (row["狀態"] || "停用").trim();
                        const photoURL = (row["大頭照"] || "").trim();
                        if (!email) { failCount++; return null; }
                        let uid = null;
                        try {
                            const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                            uid = cred.user.uid;
                            await updateProfile(cred.user, { displayName, photoURL });
                            await signOut(createAuth);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                const qUser = query(collection(db, "users"), where("email", "==", email));
                                const snapUser = await getDocs(qUser);
                                if (!snapUser.empty) uid = snapUser.docs[0].id;
                            }
                            if (!uid) { failCount++; return null; }
                        }
                        if (uid) {
                            const docRef = doc(db, "users", uid);
                            const payload = {
                                email, role: "住戶", status, displayName, phone, photoURL,
                                community: selectedSlug, seq, houseNo,
                                ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                qrCodeText, address, area, ownershipRatio, createdAt: Date.now()
                            };
                            return { docRef, payload };
                        }
                    } catch (err) { failCount++; }
                    return null;
                });
                const results = await Promise.all(promises);
                results.forEach(res => {
                    if (res) {
                        batch.set(res.docRef, res.payload, { merge: true });
                        hasWrites = true;
                        successCount++;
                    }
                });
                if (hasWrites) await batch.commit();
                updateProgress(Math.min(i + CHUNK_SIZE, total));
              }
              overlay.innerHTML = `
                <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                    <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                    <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                    <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                    <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                </div>
              `;
              const closeBtn = document.getElementById("close-overlay-btn");
              if (closeBtn) {
                  closeBtn.onclick = async () => {
                      overlay.style.display = "none";
                      await renderSettingsResidents();
                  };
              }
            } catch (e) {
              console.error(e);
              alert("讀取 Excel 失敗");
              overlay.style.display = "none";
            } finally {
              btnImportLegacy2.disabled = false;
              btnImportLegacy2.textContent = "匯入 Excel";
            }
          };
          reader.readAsArrayBuffer(file);
        } catch(e) {
          console.error(e);
          alert("匯入失敗");
          btnImportLegacy2.disabled = false;
          btnImportLegacy2.textContent = "匯入 Excel";
          if (overlay) overlay.style.display = "none";
        }
      };
      input.click();
    });

    sysNav.content.addEventListener("change", (e) => {
      if (e.target.id === "check-all-residents") {
        const checked = e.target.checked;
        const checkboxes = sysNav.content.querySelectorAll(".check-resident");
        checkboxes.forEach(cb => cb.checked = checked);
        updateDeleteSelectedBtn();
      } else if (e.target.classList.contains("check-resident")) {
        updateDeleteSelectedBtn();
      }
    });

    function updateDeleteSelectedBtn() {
       const btn = document.getElementById("btn-delete-selected");
       const checked = sysNav.content.querySelectorAll(".check-resident:checked");
       if (btn) {
         if (checked.length > 0) {
           btn.style.display = "inline-block";
           btn.textContent = `刪除選取項目 (${checked.length})`;
         } else {
           btn.style.display = "none";
         }
       }
    }

    const btnDeleteSelected = document.getElementById("btn-delete-selected");
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener("click", async () => {
         const checked = sysNav.content.querySelectorAll(".check-resident:checked");
         if (checked.length === 0) return;
         if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
         btnDeleteSelected.disabled = true;
         btnDeleteSelected.textContent = "刪除中...";
         let successCount = 0;
         let failCount = 0;
         const allIds = Array.from(checked).map(cb => cb.value);
         try {
            const limit = 10;
            const processItem = async (uid) => {
               try {
                 await deleteDoc(doc(db, "users", uid));
                 successCount++;
               } catch (e) {
                 console.error(e);
                 failCount++;
               }
            };
            for (let i = 0; i < allIds.length; i += limit) {
               const batchIds = allIds.slice(i, i + limit);
               await Promise.all(batchIds.map(uid => processItem(uid)));
            }
            showHint(`已刪除 ${successCount} 筆，失敗 ${failCount} 筆`, "success");
            await renderSettingsResidents();
         } catch (err) {
           console.error(err);
           showHint("批次刪除發生錯誤", "error");
         } finally {
           if (btnDeleteSelected) {
             btnDeleteSelected.disabled = false;
             btnDeleteSelected.textContent = "刪除選取項目";
           }
         }
      });
    }

    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-resident");
    btnEdits.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!sysNav.content) return;
        const tr = btn.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        const currentUser = auth.currentUser;
        const isSelf = currentUser && currentUser.uid === targetUid;
        let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "住戶", status: "啟用" };
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const d = snap.data();
            target.displayName = d.displayName || target.displayName;
            target.email = d.email || target.email;
            target.phone = d.phone || target.phone;
            target.photoURL = d.photoURL || target.photoURL;
            target.status = d.status || target.status;
            target.seq = d.seq;
            target.houseNo = d.houseNo;
            target.subNo = d.subNo;
            target.qrCodeText = d.qrCodeText;
            target.address = d.address;
            target.area = d.area;
            target.ownershipRatio = d.ownershipRatio;
          }
        } catch {}
        openEditModal(target, isSelf);
      });
    });

    const btnExport = document.getElementById("btn-export-resident");
    btnExport && btnExport.addEventListener("click", async () => {
      btnExport.disabled = true;
      btnExport.textContent = "匯出中...";
      try {
        await ensureXlsxLib();
        if (!window.XLSX) throw new Error("Excel Library not found");
        const data = residents.map((r, idx) => ({
          "大頭照": r.photoURL || "",
          "序號": r.seq || "",
          "戶號": r.houseNo || "",
          "子戶號": r.subNo !== undefined ? r.subNo : "",
          "QR code": r.qrCodeText || "",
          "姓名": r.displayName || "",
          "地址": r.address || "",
          "坪數": r.area || "",
          "區分權比": r.ownershipRatio || "",
          "手機號碼": r.phone || "",
          "電子郵件": r.email || "",
          "狀態": r.status || "啟用"
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
        window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch(e) {
        console.error(e);
        alert("匯出失敗");
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = "匯出 Excel";
      }
    });

    const btnImport = document.getElementById("btn-import-resident");
    btnImport && btnImport.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx, .xls, .csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let overlay = document.getElementById("import-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "import-overlay";
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
          document.body.appendChild(overlay);
        }
        overlay.style.display = "flex";
        overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
        btnImport.disabled = true;
        btnImport.textContent = "匯入中...";
        try {
          await ensureXlsxLib();
          if (!window.XLSX) throw new Error("Excel Library not found");
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = window.XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
              if (jsonData.length === 0) {
                alert("檔案內容為空");
                overlay.style.display = "none";
                return;
              }
              if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                overlay.style.display = "none";
                return;
              }
              let successCount = 0;
              let failCount = 0;
              const total = jsonData.length;
              const updateProgress = (processed) => {
                 const el = document.getElementById("import-msg");
                 if (el) el.textContent = `匯入中... ${processed} / ${total}`;
              };
              const CHUNK_SIZE = 20; 
              for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                let hasWrites = false;
                const promises = chunk.map(async (row) => {
                    try {
                        const email = (row["電子郵件"] || "").trim();
                        const password = (row["密碼"] || "123456").trim();
                        const displayName = (row["姓名"] || "").trim();
                        const phone = (row["手機號碼"] || "").toString().trim();
                        const seq = (row["序號"] || "").toString().trim();
                        const houseNo = (row["戶號"] || "").toString().trim();
                        const subNoRaw = row["子戶號"];
                        const qrCodeText = (row["QR code"] || "").trim();
                        const address = (row["地址"] || "").trim();
                        const area = (row["坪數"] || "").toString().trim();
                        const ownershipRatio = (row["區分權比"] || "").toString().trim();
                        const status = (row["狀態"] || "停用").trim();
                        const photoURL = (row["大頭照"] || "").trim();
                        if (!email) { failCount++; return null; }
                        let uid = null;
                        try {
                            const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                            uid = cred.user.uid;
                            await updateProfile(cred.user, { displayName, photoURL });
                            await signOut(createAuth);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                const qUser = query(collection(db, "users"), where("email", "==", email));
                                const snapUser = await getDocs(qUser);
                                if (!snapUser.empty) uid = snapUser.docs[0].id;
                            }
                            if (!uid) { failCount++; return null; }
                        }
                        if (uid) {
                            const docRef = doc(db, "users", uid);
                            const payload = {
                                email, role: "住戶", status, displayName, phone, photoURL,
                                community: selectedSlug, seq, houseNo,
                                ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                qrCodeText, address, area, ownershipRatio, createdAt: Date.now()
                            };
                            return { docRef, payload };
                        }
                    } catch (err) { failCount++; }
                    return null;
                });
                const results = await Promise.all(promises);
                results.forEach(res => {
                    if (res) {
                        batch.set(res.docRef, res.payload, { merge: true });
                        hasWrites = true;
                        successCount++;
                    }
                });
                if (hasWrites) await batch.commit();
                updateProgress(Math.min(i + CHUNK_SIZE, total));
              }
              overlay.innerHTML = `
                <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                    <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                    <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                    <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                    <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                </div>
              `;
              const closeBtn = document.getElementById("close-overlay-btn");
              if (closeBtn) {
                  closeBtn.onclick = async () => {
                      overlay.style.display = "none";
                      await renderSettingsResidents();
                  };
              }
            } catch (e) {
              console.error(e);
              alert("讀取 Excel 失敗");
              overlay.style.display = "none";
            } finally {
              btnImport.disabled = false;
              btnImport.textContent = "匯入 Excel";
            }
          };
          reader.readAsArrayBuffer(file);
        } catch(e) {
          console.error(e);
          alert("匯入失敗");
          btnImport.disabled = false;
          btnImport.textContent = "匯入 Excel";
          if (overlay) overlay.style.display = "none";
        }
      };
      input.click();
    });

    sysNav.content.addEventListener("change", (e) => {
      if (e.target.id === "check-all-residents") {
        const checked = e.target.checked;
        const checkboxes = sysNav.content.querySelectorAll(".check-resident");
        checkboxes.forEach(cb => cb.checked = checked);
        updateDeleteSelectedBtn();
      } else if (e.target.classList.contains("check-resident")) {
        updateDeleteSelectedBtn();
      }
    });

    function updateDeleteSelectedBtn() {
       const btn = document.getElementById("btn-delete-selected");
       const checked = sysNav.content.querySelectorAll(".check-resident:checked");
       if (btn) {
         if (checked.length > 0) {
           btn.style.display = "inline-block";
           btn.textContent = `刪除選取項目 (${checked.length})`;
         } else {
           btn.style.display = "none";
         }
       }
    }

    const btnDeleteSelectedLegacy2 = document.getElementById("btn-delete-selected");
    if (btnDeleteSelectedLegacy2) {
      btnDeleteSelectedLegacy2.addEventListener("click", async () => {
         const checked = sysNav.content.querySelectorAll(".check-resident:checked");
         if (checked.length === 0) return;
         if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
         btnDeleteSelectedLegacy2.disabled = true;
         btnDeleteSelectedLegacy2.textContent = "刪除中...";
         let successCount = 0;
         let failCount = 0;
         const allIds = Array.from(checked).map(cb => cb.value);
         try {
            const limit = 10;
            const processItem = async (uid) => {
               try {
                 await deleteDoc(doc(db, "users", uid));
                 successCount++;
               } catch (e) {
                 console.error(e);
                 failCount++;
               }
            };
            for (let i=0; i<allIds.length; i+=limit) {
                const chunk = allIds.slice(i, i+limit);
                await Promise.all(chunk.map(processItem));
            }
            alert(`刪除完成\n成功：${successCount}\n失敗：${failCount}`);
            await renderSettingsResidents();
         } catch(e) {
            console.error(e);
            alert("刪除過程發生錯誤");
         } finally {
            btnDeleteSelectedLegacy2.disabled = false;
            btnDeleteSelectedLegacy2.textContent = "刪除選取項目";
            btnDeleteSelectedLegacy2.style.display = "none";
         }
      });
    }
  }
  
  const u = auth.currentUser;
  const slug = u ? await getUserCommunity(u.uid) : "default";

  if (role === "系統管理員") {
    location.href = "sys.html";
  } else if (role === "管理員" || role === "總幹事") {
    location.href = (slug && slug !== "default") ? `admin.html?c=${slug}` : "admin.html";
  } else {
    location.href = (slug && slug !== "default") ? `front.html?c=${slug}` : "front.html";
  }
}

  // Auto login check
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (el.authCard) el.authCard.classList.add("hidden");
      
      const pathNow = window.location.pathname || "";
      if (
        (pathNow.endsWith("/") || pathNow.includes("index.html")) &&
        !pathNow.includes("front") && !pathNow.includes("admin") && !pathNow.includes("sys")
      ) {
        try {
          const userSlug = await getUserCommunity(user.uid);
          const target = (userSlug && userSlug !== "default") ? `front.html?c=${userSlug}` : "front.html";
          location.replace(target);
          return;
        } catch {
          location.replace("front.html");
          return;
        }
      }
      
      let role = "住戶";
      try {
        role = await getOrCreateUserRole(user.uid, user.email);
      } catch {}

      // Strict Page Access Check
      if (!checkPagePermission(role, window.location.pathname)) {
          if (el.authCard) el.authCard.classList.remove("hidden");
          if (sysStack) sysStack.classList.add("hidden");
          if (adminStack) adminStack.classList.add("hidden");
          if (frontStack) frontStack.classList.add("hidden");
          if (mainContainer) mainContainer.classList.remove("hidden");
          showHint("權限不足，已自動登出", "error");
          await signOut(auth);
          return; 
      }

      // If we are on specific pages, handle display
      if (window.location.pathname.includes("sys")) {
          // Role check passed (System Admin)
          toggleAuth(false);
         if (sysStack) sysStack.classList.remove("hidden");
         if (mainContainer) mainContainer.classList.add("hidden");
         const tipSys = document.getElementById("orientation-tip");
         tipSys && tipSys.classList.add("hidden");
            const btn = document.getElementById("btn-avatar-sys");
            if (btn) {
              const u = auth.currentUser;
              let photo = (u && u.photoURL) || "";
              let name = (u && u.displayName) || "";
              try {
                const snap = await getDoc(doc(db, "users", u.uid));
                if (snap.exists()) {
                  const d = snap.data();
                  photo = photo || d.photoURL || "";
                  name = name || d.displayName || "";
                }
              } catch {}
              const w = document.getElementById("welcome-sys");
              if (w) {
                const emailPart = (u && u.email && u.email.split("@")[0]) || "";
                w.textContent = `歡迎~${name || emailPart || "使用者"}`;
              }
              btn.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "用")[0]}</span>`;
              btn.addEventListener("click", () => openUserProfileModal());
            }
  } else if (window.location.pathname.includes("front")) {
        // Role check passed (Resident or System Admin)
        const pathSlug = getSlugFromPath();
        const qp = getQueryParam("c");
        const userSlug = await getUserCommunity(user.uid);
        const reqSlug = pathSlug || qp || null;
        const slug = role === "系統管理員" ? (reqSlug || userSlug) : userSlug;
        if (role !== "系統管理員" && reqSlug && reqSlug !== userSlug) {
          location.replace(`front.html?c=${userSlug}`);
          return;
        }
        
        let cname = slug;
        try {
          const csnap = await getDoc(doc(db, "communities", slug));
          if (csnap.exists()) {
            const c = csnap.data();
            communityConfigs[slug] = {
              apiKey: c.apiKey,
              authDomain: c.authDomain,
              projectId: c.projectId,
              storageBucket: c.storageBucket,
              messagingSenderId: c.messagingSenderId,
              appId: c.appId,
              measurementId: c.measurementId
            };
            cname = c.name || slug;
          }
        } catch {}
        const t = ensureTenant(slug);
        window.currentTenantSlug = slug;
        window.tenant = t;
        const titleEl = document.querySelector(".sys-title");
        if (titleEl) {
           titleEl.textContent = `${cname} 社區`;
           if (role === "系統管理員") {
             titleEl.style.cursor = "pointer";
             titleEl.style.textDecoration = "underline";
             titleEl.title = "點擊切換社區";
             titleEl.addEventListener("click", () => openCommunitySwitcher("front"));
           }
        }
        const wFront = document.getElementById("welcome-front");
        if (wFront) {
          const u = auth.currentUser;
          const emailPart = (u && u.email && u.email.split("@")[0]) || "";
          const snap = await getDoc(doc(db, "users", u.uid));
          let name = "";
          if (snap.exists()) {
            const d = snap.data();
            name = d.displayName || "";
          }
          wFront.textContent = `歡迎~${name || emailPart || "使用者"}`;
        }
        if (frontStack) frontStack.classList.remove("hidden");
        if (mainContainer) mainContainer.classList.add("hidden");
        const tip = document.getElementById("orientation-tip");
        tip && tip.classList.add("hidden");

        const btnAvatar = document.getElementById("btn-avatar-front");
        if (btnAvatar) {
           const u = auth.currentUser;
           let photo = (u && u.photoURL) || "";
           let name = (u && u.displayName) || "";
           try {
             const snap = await getDoc(doc(db, "users", u.uid));
             if (snap.exists()) {
               const d = snap.data();
               photo = photo || d.photoURL || "";
               name = name || d.displayName || "";
             }
           } catch {}
           btnAvatar.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "用")[0]}</span>`;
            btnAvatar.addEventListener("click", () => openUserProfileModal());
        }
        loadFrontAds(slug);
        loadFrontButtons(slug);
        subscribeFrontButtons(slug);
        startFrontPolling(slug);
    } else if (window.location.pathname.includes("admin")) {
        // Role check passed (Community Admin or System Admin)
          const pathSlug = getSlugFromPath();
          const qp = getQueryParam("c");
          const userSlug = await getUserCommunity(user.uid);
          const reqSlug = pathSlug || qp || null;
          if (role !== "系統管理員" && reqSlug && reqSlug !== userSlug) {
            location.replace(`admin.html?c=${userSlug}`);
            return;
          }
          const slug = role === "系統管理員" ? (reqSlug || userSlug) : userSlug;
          
          if (adminStack) adminStack.classList.remove("hidden");
          if (mainContainer) mainContainer.classList.add("hidden");
          const tip2 = document.getElementById("orientation-tip");
          tip2 && tip2.classList.add("hidden");

          let cname = slug;
          try {
             if(slug && slug !== "default") {
               const csnap = await getDoc(doc(db, "communities", slug));
               if (csnap.exists()) {
                 const c = csnap.data();
                 cname = c.name || slug;
               }
             }
          } catch {}
          const titleEl = adminStack.querySelector(".sys-title");
          if (titleEl && cname && cname !== "default") {
             titleEl.textContent = `${cname} 社區管理後台`;
             if (role === "系統管理員") {
                titleEl.style.cursor = "pointer";
                titleEl.style.textDecoration = "underline";
                titleEl.title = "點擊切換社區";
                titleEl.addEventListener("click", () => openCommunitySwitcher("admin"));
             }
          }
          
          const btnAvatarAdmin = document.getElementById("btn-avatar-admin");
          if (btnAvatarAdmin) {
            const u = auth.currentUser;
            let photo = (u && u.photoURL) || "";
            let name = (u && u.displayName) || "";
            try {
              const snap = await getDoc(doc(db, "users", u.uid));
              if (snap.exists()) {
                const d = snap.data();
                photo = photo || d.photoURL || "";
                name = name || d.displayName || "";
              }
            } catch {}
            const wAdmin = document.getElementById("welcome-admin");
            if (wAdmin) {
              const emailPart = (u && u.email && u.email.split("@")[0]) || "";
              wAdmin.textContent = `歡迎~${name || emailPart || "使用者"}`;
            }
            btnAvatarAdmin.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "管")[0]}</span>`;
            btnAvatarAdmin.addEventListener("click", () => openUserProfileModal());
          }
    }
    
    if (el.profileEmail) el.profileEmail.textContent = user.email;
    // We can fetch role here if needed for profile card
    } else {
      toggleAuth(true);
      const pathNow = window.location.pathname || "";
      if (pathNow.includes("front")) {
        location.replace("index.html");
        return;
      }
    }
  });

async function openCommunitySwitcher(type) {
  const modal = document.createElement("div");
  modal.className = "modal";
  
  let communities = [];
  try {
    const q = query(collection(db, "communities"));
    const snap = await getDocs(q);
    communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error(e);
    return alert("無法載入社區列表");
  }

  const listHtml = communities.map(c => `
    <div class="modal-row" style="cursor:pointer; padding: 10px; border-bottom: 1px solid #eee;" onclick="location.href='${type}.html?c=${c.id}'">
      <strong>${c.name || c.id}</strong> <span style="color:#888">(${c.id})</span>
    </div>
  `).join("");

  modal.innerHTML = `
    <div class="modal-dialog" style="max-height: 80vh; overflow-y: auto;">
      <div class="modal-head">
        <div class="modal-title">切換社區 (${type === 'admin' ? '後台' : '前台'})</div>
      </div>
      <div class="modal-body">
         ${listHtml || '<div style="padding:20px;text-align:center">無社區資料</div>'}
      </div>
      <div class="modal-foot">
        <button class="btn action-btn" onclick="this.closest('.modal').remove()">關閉</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}


// Sign out handlers
[btnSignoutFront, btnSignoutAdmin, btnSignoutSys, el.btnSignout].forEach(btn => {
  if (btn) {
    btn.addEventListener("click", async () => {
      await signOut(auth);
      redirectAfterSignOut();
    });
  }
});

// Admin signout specifically needs to find the button again if it was added dynamically or just ensure it works
if (!btnSignoutAdmin) {
    // If it wasn't found initially (maybe because it was in hidden section?), try to bind it if it exists now
    const retryBtn = document.getElementById("btn-signout-admin");
    if (retryBtn) {
        retryBtn.addEventListener("click", async () => {
          await signOut(auth);
          redirectAfterSignOut();
        });
    }
}

// Password toggle
if (btnTogglePassword) {
  const iconShow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const iconHide = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
  
  btnTogglePassword.innerHTML = iconShow;
  
  btnTogglePassword.addEventListener("click", () => {
    const isPassword = el.password.getAttribute("type") === "password";
    el.password.setAttribute("type", isPassword ? "text" : "password");
    btnTogglePassword.innerHTML = isPassword ? iconHide : iconShow;
  });
}

// System Admin Page Navigation Logic
const sysNav = {
  home: document.getElementById("sys-nav-home"),
  notify: document.getElementById("sys-nav-notify"),
  settings: document.getElementById("sys-nav-settings"),
  app: document.getElementById("sys-nav-app"),
  subContainer: document.getElementById("sys-sub-nav"),
  content: document.getElementById("sys-content")
};

const sysSubMenus = {
  home: ["總覽", "社區"],
  notify: ["系統", "社區", "住戶"],
  settings: ["一般", "社區", "住戶", "系統"],
  app: ["廣告", "按鈕", "監控", "區大"]
};

if (sysNav.subContainer) {
  const adminAccounts = [
    // Use current authenticated admin account
  ];
  
  async function renderSettingsGeneral() {
    if (!sysNav.content) return;
    const user = auth.currentUser;
    const email = (user && user.email) || "nwapp.eason@gmail.com";
    const uid = user && user.uid;
    let role = "系統管理員";
    let status = "啟用";
    let name = (user && user.displayName) || "系統管理員";
    let phone = "";
    let photoURL = (user && user.photoURL) || "";
    if (uid) {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          const d = snap.data();
          phone = d.phone || phone;
          name = name || d.displayName || name;
          photoURL = photoURL || d.photoURL || photoURL;
        }
      } catch (e) {
        console.warn("Fetch user doc failed", e);
      }
    }
    const avatarHtml = photoURL 
      ? `<img class="avatar" src="${photoURL}" alt="avatar">`
      : `<span class="avatar">${(name || email)[0]}</span>`;
    // Fetch admin list from Firestore
    let admins = [];
    try {
      const q = query(collection(db, "users"), where("role", "==", "系統管理員"));
      const snapList = await getDocs(q);
      admins = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Query admins failed", e);
    }
    if (!admins.length) {
      admins = [{ id: uid || "me", email, role, status, displayName: name, phone, photoURL }];
    }
    const rows = admins.map(a => {
      const nm = a.displayName || "系統管理員";
      const av = a.photoURL 
        ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
        : `<span class="avatar">${(nm || a.email)[0]}</span>`;
      return `
        <tr data-uid="${a.id}">
          <td class="avatar-cell">${av}</td>
          <td>${nm}</td>
          <td>${a.phone || ""}</td>
          <td>••••••</td>
          <td>${a.email}</td>
          <td>${a.role}</td>
          <td class="status">${a.status || "啟用"}</td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-admin">編輯</button>
            <button class="btn small action-btn danger btn-delete-admin">刪除</button>
          </td>
        </tr>
      `;
    }).join("");
    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">系統管理員帳號列表</h1>
          <button id="btn-create-admin" class="btn small action-btn">新增</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup>
              <col>
              <col>
              <col>
              <col>
              <col>
              <col>
              <col>
              <col>
            </colgroup>
            <thead>
              <tr>
                <th>大頭照</th>
                <th>姓名</th>
                <th>手機號碼</th>
                <th>密碼</th>
                <th>電子郵件</th>
                <th>角色</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    // Bind actions for each row
    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-admin");
    const btnDeletes = sysNav.content.querySelectorAll(".btn-delete-admin");
    btnEdits.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!sysNav.content) return;
        const tr = btn.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        const currentUser = auth.currentUser;
        const isSelf = currentUser && currentUser.uid === targetUid;
        // Fetch doc for target
        let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "系統管理員", status: "啟用" };
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const d = snap.data();
            target.displayName = d.displayName || target.displayName;
            target.email = d.email || target.email;
            target.phone = d.phone || target.phone;
            target.photoURL = d.photoURL || target.photoURL;
            target.status = d.status || target.status;
            target.seq = d.seq;
            target.houseNo = d.houseNo;
            target.subNo = d.subNo;
            target.qrCodeText = d.qrCodeText;
            target.address = d.address;
            target.area = d.area;
            target.ownershipRatio = d.ownershipRatio;
          }
        } catch {}
        openEditModal(target, isSelf);
      });
    });
    btnDeletes.forEach(btn => {
      btn.addEventListener("click", async () => {
        const ok1 = window.confirm("確定要刪除此帳號嗎？此操作不可恢復。");
        if (!ok1) return;
        const ok2 = window.confirm("再次確認：刪除後將立即登出。是否繼續？");
        if (!ok2) return;
        try {
          const tr = btn.closest("tr");
          const targetUid = tr && tr.getAttribute("data-uid");
          const curr = auth.currentUser;
          if (curr && curr.uid === targetUid) {
            await curr.delete();
            showHint("已刪除目前帳號", "success");
            redirectAfterSignOut();
          } else {
            // Client SDK無法刪除其他用戶，這裡僅更新標記狀態
            await setDoc(doc(db, "users", targetUid), { status: "停用" }, { merge: true });
            showHint("已標記該帳號為停用", "success");
            await renderSettingsGeneral();
          }
        } catch (err) {
          console.error(err);
          showHint("刪除失敗，可能需要重新登入驗證", "error");
        }
      });
    });
    const btnCreate = document.getElementById("btn-create-admin");
    if (btnCreate) {
      btnCreate.addEventListener("click", () => openCreateModal());
    }
  }
  
  async function renderSettingsCommunity() {
    if (!sysNav.content) return;
    let list = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    list.forEach(c => {
      communityConfigs[c.id] = {
        apiKey: c.apiKey,
        authDomain: c.authDomain,
        projectId: c.projectId,
        storageBucket: c.storageBucket,
        messagingSenderId: c.messagingSenderId,
        appId: c.appId,
        measurementId: c.measurementId
      };
    });
    const rows = list.map(c => `
      <tr data-slug="${c.id}">
        <td>${c.id}</td>
        <td>${c.name || ""}</td>
        <td>${c.projectId || ""}</td>
        <td>${c.status || "啟用"}</td>
        <td class="actions">
          <button class="btn small action-btn btn-edit-community">編輯</button>
          <button class="btn small action-btn danger btn-delete-community">刪除</button>
          <button class="btn small action-btn btn-go-community">進入社區</button>
        </td>
      </tr>
    `).join("");
    // 準備社區後台帳號（以目前使用者所在社區為基準）
    const u = auth.currentUser;
    let mySlug = u ? await getUserCommunity(u.uid) : "default";
    
    // 使用 window 變數記錄目前選擇的社區，若無則預設為使用者的社區
    let selectedSlug = window.currentAdminCommunitySlug || mySlug;

    if (selectedSlug === "default" && list.length > 0) {
      selectedSlug = list[0].id;
    }
    let cname = selectedSlug;
    const foundC = list.find(x => x.id === selectedSlug);
    if (foundC) cname = foundC.name || selectedSlug;
    
    let admins = [];
    try {
      const qAdmins = query(collection(db, "users"), where("community", "==", selectedSlug), where("role", "in", ["管理員", "總幹事"]));
      const snapAdmins = await getDocs(qAdmins);
      admins = snapAdmins.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const adminRows = admins.map(a => {
      const nm = a.displayName || (a.email || "").split("@")[0] || "管理員";
      const av = a.photoURL
        ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
        : `<span class="avatar">${(nm || a.email || "管")[0]}</span>`;
      return `
        <tr data-uid="${a.id}" data-slug="${selectedSlug}">
          <td class="avatar-cell">${av}</td>
          <td>${nm}</td>
          <td>${a.phone || ""}</td>
          <td>${a.email || ""}</td>
          <td>${a.role || "管理員"}</td>
          <td class="status">${a.status || "啟用"}</td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-community-admin">編輯</button>
            <button class="btn small action-btn danger btn-delete-community-admin">刪除</button>
            <button class="btn small action-btn btn-go-community-admin">進入後台</button>
          </td>
        </tr>
      `;
    }).join("");
    const adminEmpty = adminRows ? "" : "目前沒有後台帳號";
    
    // 建立社區選擇器的選項
    const adminCommunityOptions = list.map(c => 
      `<option value="${c.id}"${c.id === selectedSlug ? " selected" : ""}>${c.name || c.id}</option>`
    ).join("");

    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-head">
          <h1 class="card-title">社區設定</h1>
          <button id="btn-create-community" class="btn small action-btn">新增</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup><col><col><col><col><col></colgroup>
            <thead>
              <tr>
                <th>社區代碼</th>
                <th>名稱</th>
                <th>Firebase 專案ID</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="card data-card mt-24">
        <div class="card-filters">
          <label for="admin-community-select">社區</label>
          <select id="admin-community-select">${adminCommunityOptions}</select>
        </div>
        <div class="card-head">
          <h1 class="card-title">社區後台帳號（${cname}）</h1>
          <button id="btn-create-community-admin" class="btn small action-btn">新增</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup><col><col><col><col><col><col><col></colgroup>
            <thead>
              <tr>
                <th>大頭照</th>
                <th>姓名</th>
                <th>手機號碼</th>
                <th>電子郵件</th>
                <th>角色</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${adminRows}</tbody>
          </table>
          ${adminEmpty ? `<div class="empty-hint">${adminEmpty}</div>` : ""}
        </div>
      </div>
    `;
    
    const adminSel = document.getElementById("admin-community-select");
    adminSel && adminSel.addEventListener("change", async () => {
      window.currentAdminCommunitySlug = adminSel.value;
      await renderSettingsCommunity();
    });

    const btnCreate = document.getElementById("btn-create-community");
    btnCreate && btnCreate.addEventListener("click", () => openCommunityModal());
    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-community");
    btnEdits.forEach(b => b.addEventListener("click", () => {
      const tr = b.closest("tr");
      const slug = tr && tr.getAttribute("data-slug");
      const found = list.find(x => x.id === slug);
      openCommunityModal(found || { id: slug });
    }));
    const btnDeletes = sysNav.content.querySelectorAll(".btn-delete-community");
    btnDeletes.forEach(b => b.addEventListener("click", async () => {
      const ok = window.confirm("確定要刪除此社區設定嗎？此操作不可恢復。");
      if (!ok) return;
      const tr = b.closest("tr");
      const slug = tr && tr.getAttribute("data-slug");
      if (!slug) return;
      try {
        await deleteDoc(doc(db, "communities", slug));
        delete communityConfigs[slug];
        showHint("已刪除該社區設定", "success");
        await renderSettingsCommunity();
      } catch (e) {
        console.error(e);
        showHint("刪除社區失敗，請稍後再試", "error");
      }
    }));
    const btnGos = sysNav.content.querySelectorAll(".btn-go-community");
    btnGos.forEach(b => b.addEventListener("click", () => {
      const tr = b.closest("tr");
      const slug = tr && tr.getAttribute("data-slug");
      const found = list.find(x => x.id === slug);
      const status = (found && found.status) || "啟用";
      if (status === "停用") {
        showHint("該社區已停用，無法進入", "error");
        return;
      }
      const url = `front.html?c=${slug}`;
      const w = window.open(url, "_blank");
      if (w) w.opener = null;
    }));
    const btnCreateAdmin = document.getElementById("btn-create-community-admin");
    btnCreateAdmin && btnCreateAdmin.addEventListener("click", () => openCreateCommunityAdminModal(selectedSlug));
    const btnEditAdmins = sysNav.content.querySelectorAll(".btn-edit-community-admin");
    btnEditAdmins.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!sysNav.content) return;
        const tr = btn.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        const currentUser = auth.currentUser;
        const isSelf = currentUser && currentUser.uid === targetUid;
        let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "管理員", status: "啟用" };
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const d = snap.data();
            target.displayName = d.displayName || target.displayName;
            target.email = d.email || target.email;
            target.phone = d.phone || target.phone;
            target.photoURL = d.photoURL || target.photoURL;
            target.status = d.status || target.status;
          }
        } catch {}
        openEditModal(target, isSelf);
      });
    });
    const btnDeleteAdmins = sysNav.content.querySelectorAll(".btn-delete-community-admin");
    btnDeleteAdmins.forEach(btn => {
      btn.addEventListener("click", async () => {
        const ok = window.confirm("確定要刪除此後台帳號嗎？此操作不可恢復。");
        if (!ok) return;
        try {
          const tr = btn.closest("tr");
          const targetUid = tr && tr.getAttribute("data-uid");
          if (!targetUid) return;
          await setDoc(doc(db, "users", targetUid), { status: "停用" }, { merge: true });
          showHint("已標記該後台帳號為停用", "success");
          await renderSettingsCommunity();
        } catch (e) {
          console.error(e);
          showHint("刪除失敗，請稍後再試", "error");
        }
      });
    });
    const btnGoAdmins = sysNav.content.querySelectorAll(".btn-go-community-admin");
    btnGoAdmins.forEach(btn => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const slug = tr && tr.getAttribute("data-slug");
        if (!slug) return;
        
        // Check role validation again just in case (though target page checks too)
        const user = auth.currentUser;
        if (user) {
           const role = await getOrCreateUserRole(user.uid, user.email);
           const userSlug = await getUserCommunity(user.uid);
           if (role !== "系統管理員" && slug !== userSlug) {
              // If not sys admin, ensure they only go to their own community
              location.replace(`admin.html?c=${userSlug}`);
              return;
           }
        }
        
        const url = `admin.html?c=${slug}`;
        const w = window.open(url, "_blank");
        if (w) w.opener = null;
      });
    });
  }
  
  function openCommunityModal(comm) {
    const data = comm || {};
    const title = data.id ? "編輯社區" : "新增社區";
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>社區代碼</label>
            <input type="text" id="c-slug" value="${data.id || ""}" placeholder="如：north">
          </div>
          <div class="modal-row">
            <label>名稱</label>
            <input type="text" id="c-name" value="${data.name || ""}">
          </div>
          <div class="modal-row"><label>apiKey</label><input type="text" id="c-apiKey" value="${data.apiKey || ""}"></div>
          <div class="modal-row"><label>authDomain</label><input type="text" id="c-authDomain" value="${data.authDomain || ""}"></div>
          <div class="modal-row"><label>projectId</label><input type="text" id="c-projectId" value="${data.projectId || ""}"></div>
          <div class="modal-row"><label>storageBucket</label><input type="text" id="c-storageBucket" value="${data.storageBucket || ""}"></div>
          <div class="modal-row"><label>messagingSenderId</label><input type="text" id="c-msgId" value="${data.messagingSenderId || ""}"></div>
          <div class="modal-row"><label>appId</label><input type="text" id="c-appId" value="${data.appId || ""}"></div>
          <div class="modal-row"><label>measurementId</label><input type="text" id="c-measurementId" value="${data.measurementId || ""}"></div>
          <div class="modal-row"><label>狀態</label>
            <select id="c-status">
              <option value="啟用"${(data.status || "啟用")==="啟用" ? " selected" : ""}>啟用</option>
              <option value="停用"${(data.status || "啟用")==="停用" ? " selected" : ""}>停用</option>
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button id="c-cancel" class="btn action-btn danger">取消</button>
          <button id="c-save" class="btn action-btn">儲存</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("c-cancel");
    const btnSave = document.getElementById("c-save");
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      const slug = document.getElementById("c-slug").value.trim();
      const name = document.getElementById("c-name").value.trim();
      const apiKey = document.getElementById("c-apiKey").value.trim();
      const authDomain = document.getElementById("c-authDomain").value.trim();
      const projectId = document.getElementById("c-projectId").value.trim();
      const storageBucket = document.getElementById("c-storageBucket").value.trim();
      const messagingSenderId = document.getElementById("c-msgId").value.trim();
      const appId = document.getElementById("c-appId").value.trim();
      const measurementId = document.getElementById("c-measurementId").value.trim();
      const status = document.getElementById("c-status").value;
      if (!slug || !apiKey || !authDomain || !projectId || !appId) {
        showHint("請填入必要欄位（slug/apiKey/authDomain/projectId/appId）", "error");
        return;
      }
      try {
        const payload = { name, apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId, status, updatedAt: Date.now() };
        await setDoc(doc(db, "communities", slug), payload, { merge: true });
        communityConfigs[slug] = {
          apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId
        };
        closeModal();
        await renderSettingsCommunity();
        showHint("社區設定已儲存", "success");
      } catch (e) {
        showHint("儲存失敗", "error");
      }
    });
  }
  
  function openCreateCommunityAdminModal(slug) {
    const title = "新增社區後台帳號";
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-ca-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="password" id="create-ca-password" placeholder="至少6字元">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-ca-name">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-ca-phone">
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-ca-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-ca-photo-preview" class="avatar-preview">
          </div>
          <div class="hint" id="create-ca-hint"></div>
        </div>
        <div class="modal-foot">
          <button id="create-ca-cancel" class="btn action-btn danger">取消</button>
          <button id="create-ca-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-ca-cancel");
    const btnSave = document.getElementById("create-ca-save");
    const createFile = document.getElementById("create-ca-photo-file");
    const createPreview = document.getElementById("create-ca-photo-preview");
    const hintEl = document.getElementById("create-ca-hint");

    const showModalHint = (msg, type="error") => {
        if(hintEl) {
            hintEl.textContent = msg;
            hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
        }
    };

    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) {
        createPreview.src = URL.createObjectURL(f);
      }
    });
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        showModalHint("");
        const email = document.getElementById("create-ca-email").value.trim();
        const password = document.getElementById("create-ca-password").value;
        const displayName = document.getElementById("create-ca-name").value.trim();
        const phone = document.getElementById("create-ca-phone").value.trim();
        const photoFile = document.getElementById("create-ca-photo-file").files[0];
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showModalHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }

        btnSave.disabled = true;
        btnSave.textContent = "建立中...";

        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showModalHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showModalHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "管理員",
          status: "啟用",
          displayName,
          phone,
          photoURL,
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        await renderSettingsCommunity();
        showHint("已建立社區後台帳號", "success");
      } catch (e) {
        console.error(e);
        let msg = "建立失敗";
        if (e.code === 'auth/email-already-in-use') msg = "該 Email 已被使用";
        else if (e.code === 'auth/invalid-email') msg = "Email 格式不正確";
        else if (e.code === 'auth/weak-password') msg = "密碼強度不足";
        else if (e.message) msg += ": " + e.message;
        
        showModalHint(msg, "error");
      } finally {
        if(btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = "建立";
        }
      }
    });
  }
  async function openEditModal(target, isSelf) {
    const isResident = (target.role || "住戶") === "住戶";
    if (isResident) {
      const titleR = "編輯住戶";
      const seqR = target.seq || "";
      const bodyR = `
        <div class="modal-dialog">
          <div class="modal-head"><div class="modal-title">${titleR}</div></div>
          <div class="modal-body">
            <div class="modal-row">
              <label>大頭照</label>
              <input type="file" id="modal-photo-file" accept="image/png,image/jpeg">
            </div>
            <div class="modal-row">
              <label>預覽</label>
              <img id="modal-photo-preview" class="avatar-preview" src="${target.photoURL || ""}">
            </div>
            <div class="modal-row">
              <label>序號</label>
              <input type="text" id="modal-serial" value="${seqR}">
            </div>
            <div class="modal-row">
              <label>戶號</label>
              <input type="text" id="modal-house-no" value="${target.houseNo || ""}">
            </div>
            <div class="modal-row">
              <label>子戶號</label>
              <input type="number" id="modal-sub-no" value="${typeof target.subNo === "number" ? target.subNo : ""}">
            </div>
            <div class="modal-row">
              <label>QR 預覽</label>
              <img id="modal-qr-preview" class="qr-preview" src="">
            </div>
            <div class="modal-row">
              <label>QR code 代碼</label>
              <input type="text" id="modal-qr-code" value="${(target.qrCodeText || "")}">
            </div>
            <div class="modal-row">
              <label>姓名</label>
              <input type="text" id="modal-name" value="${target.displayName || ""}">
            </div>
            <div class="modal-row">
              <label>地址</label>
              <input type="text" id="modal-address" value="${target.address || ""}">
            </div>
            <div class="modal-row">
              <label>坪數</label>
              <input type="number" id="modal-area" value="${target.area || ""}">
            </div>
            <div class="modal-row">
              <label>區分權比</label>
              <input type="number" id="modal-ownership" value="${target.ownershipRatio || ""}">
            </div>
            <div class="modal-row">
              <label>手機號碼</label>
              <input type="tel" id="modal-phone" value="${target.phone || ""}">
            </div>
            <div class="modal-row">
              <label>電子郵件</label>
              <input type="email" id="modal-email" value="${target.email || ""}">
            </div>
            <div class="modal-row">
              <label>新密碼</label>
              <input type="text" id="modal-password" placeholder="至少6字元">
            </div>
            <div class="modal-row">
              <label>狀態</label>
              <select id="modal-status">
                <option value="啟用">啟用</option>
                <option value="停用">停用</option>
              </select>
            </div>
          </div>
          <div class="modal-foot">
            <button id="modal-cancel" class="btn action-btn danger">取消</button>
            <button id="modal-save" class="btn action-btn">儲存</button>
          </div>
        </div>
      `;
      openModal(bodyR);
      const btnCancel = document.getElementById("modal-cancel");
      const btnSave = document.getElementById("modal-save");
      const editFile = document.getElementById("modal-photo-file");
      const editPreview = document.getElementById("modal-photo-preview");
      const statusSelect = document.getElementById("modal-status");
      const editQrPreview = document.getElementById("modal-qr-preview");
      const editQrCodeInput = document.getElementById("modal-qr-code");
      if (editPreview) editPreview.src = target.photoURL || "";
      if (statusSelect) statusSelect.value = target.status || "停用";
      editFile && editFile.addEventListener("change", () => {
        const f = editFile.files[0];
        if (f) {
          editPreview.src = URL.createObjectURL(f);
        }
      });
      editQrCodeInput && editQrCodeInput.addEventListener("input", async () => {
        const val = editQrCodeInput.value.trim();
        if (!editQrPreview) return;
        if (!val) {
          editQrPreview.src = "";
        } else {
          const url = await getQrDataUrl(val, 64);
          editQrPreview.src = url;
        }
      });
      (async () => {
        const val = editQrCodeInput ? editQrCodeInput.value.trim() : "";
        if (editQrPreview && val) {
          const url = await getQrDataUrl(val, 64);
          editQrPreview.src = url;
        }
      })();
      btnCancel && btnCancel.addEventListener("click", () => closeModal());
      btnSave && btnSave.addEventListener("click", async () => {
        try {
          const newName = document.getElementById("modal-name").value.trim();
          const newSeq = document.getElementById("modal-serial").value.trim();
          const newPhone = document.getElementById("modal-phone").value.trim();
          const photoFile = document.getElementById("modal-photo-file").files[0];
          const newPassword = document.getElementById("modal-password").value;
          const newStatus = document.getElementById("modal-status").value;
          const newHouseNo = document.getElementById("modal-house-no").value.trim();
          const newSubNoRaw = document.getElementById("modal-sub-no").value.trim();
          const newSubNo = newSubNoRaw !== "" ? parseInt(newSubNoRaw, 10) : undefined;
          const newAddress = document.getElementById("modal-address").value.trim();
          const newArea = document.getElementById("modal-area").value.trim();
          const newOwnership = document.getElementById("modal-ownership").value.trim();
          const newQrCodeText = document.getElementById("modal-qr-code").value.trim();
          const newEmail = document.getElementById("modal-email").value.trim();
          let newPhotoURL = target.photoURL || "";
          if (photoFile) {
            try {
              const ext = photoFile.type === "image/png" ? "png" : "jpg";
              const path = `avatars/${target.id}.${ext}`;
              const ref = storageRef(storage, path);
              await uploadBytes(ref, photoFile, { contentType: photoFile.type });
              newPhotoURL = await getDownloadURL(ref);
            } catch (err) {
              try {
                const b64 = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(photoFile);
                });
                newPhotoURL = b64;
                showHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
              } catch {
                showHint("上傳大頭照失敗，先以原圖進行更新", "error");
              }
            }
          }
          const payload = {
            displayName: newName || target.displayName,
            seq: newSeq,
            phone: newPhone || target.phone,
            photoURL: newPhotoURL,
            status: newStatus || target.status,
            houseNo: newHouseNo || target.houseNo || "",
            address: newAddress || target.address || "",
            qrCodeText: newQrCodeText || target.qrCodeText || "",
            area: newArea || target.area || "",
            ownershipRatio: newOwnership || target.ownershipRatio || "",
            email: newEmail || target.email || ""
          };
          if (newSubNoRaw !== "") payload.subNo = isNaN(newSubNo) ? target.subNo : newSubNo;
          await setDoc(doc(db, "users", target.id), payload, { merge: true });
          const curr = auth.currentUser;
          if (isSelf && curr) {
            const profilePatch = {};
            if (newName && newName !== curr.displayName) profilePatch.displayName = newName;
            if (newPhotoURL && newPhotoURL !== curr.photoURL) profilePatch.photoURL = newPhotoURL;
            if (Object.keys(profilePatch).length) {
              try {
                await updateProfile(curr, profilePatch);
              } catch (err) {
                if (err && err.code === "auth/requires-recent-login") {
                  const cp = window.prompt("請輸入目前密碼以完成更新");
                  if (cp) {
                    try {
                      const cred = EmailAuthProvider.credential(curr.email, cp);
                      await reauthenticateWithCredential(curr, cred);
                      await updateProfile(curr, profilePatch);
                    } catch {}
                  }
                }
              }
            }
            if (newPassword && newPassword.length >= 6) {
              try {
                await updatePassword(curr, newPassword);
              } catch (err) {
                if (err && err.code === "auth/requires-recent-login") {
                  const cp = window.prompt("請輸入目前密碼以完成設定新密碼");
                  if (cp) {
                    try {
                      const cred = EmailAuthProvider.credential(curr.email, cp);
                      await reauthenticateWithCredential(curr, cred);
                      await updatePassword(curr, newPassword);
                    } catch {}
                  }
                }
              }
            }
          }
          closeModal();
          await renderSettingsResidents();
          showHint("已更新住戶資料", "success");
        } catch (e) {
          showHint("更新失敗", "error");
        }
      });
      return;
    }
    const title = (target.role === "系統管理員") ? "編輯系統管理員" : "編輯社區管理員";
    let commList = [];
    try {
      const snapC = await getDocs(collection(db, "communities"));
      commList = snapC.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const selectedCommunity = target.community || window.currentAdminCommunitySlug || "default";
    const optionsHtml = commList.map(c => `<option value="${c.id}"${c.id === selectedCommunity ? " selected" : ""}>${c.name || c.id}</option>`).join("");
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>所屬社區</label>
            <select id="modal-community">${optionsHtml}</select>
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="modal-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="modal-photo-preview" class="avatar-preview" src="${target.photoURL || ""}">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="modal-name" value="${target.displayName || ""}">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="modal-phone" value="${target.phone || ""}">
          </div>
          <div class="modal-row">
            <label>狀態</label>
            <select id="modal-status">
              <option value="啟用">啟用</option>
              <option value="停用">停用</option>
            </select>
          </div>
          <div class="modal-row">
            <label>新密碼</label>
            <input type="password" id="modal-password" placeholder="至少6字元">
          </div>
        </div>
        <div class="modal-foot">
          <button id="modal-cancel" class="btn action-btn danger">取消</button>
          <button id="modal-save" class="btn action-btn">儲存</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("modal-cancel");
    const btnSave = document.getElementById("modal-save");
    const editFile = document.getElementById("modal-photo-file");
    const editPreview = document.getElementById("modal-photo-preview");
    const statusSelect = document.getElementById("modal-status");
    if (editPreview) editPreview.src = target.photoURL || "";
    if (statusSelect) statusSelect.value = target.status || "啟用";
    editFile && editFile.addEventListener("change", () => {
      const f = editFile.files[0];
      if (f) {
        editPreview.src = URL.createObjectURL(f);
      }
    });
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        const newName = document.getElementById("modal-name").value.trim();
        const newPhone = document.getElementById("modal-phone").value.trim();
        const photoFile = document.getElementById("modal-photo-file").files[0];
        const newPassword = document.getElementById("modal-password").value;
        const newStatus = document.getElementById("modal-status").value;
        const newCommunity = (document.getElementById("modal-community") && document.getElementById("modal-community").value) || selectedCommunity;
        let newPhotoURL = target.photoURL || "";
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${target.id}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            newPhotoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              newPhotoURL = b64;
              showHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showHint("上傳大頭照失敗，先以原圖進行更新", "error");
            }
          }
        }
        // Update Firestore doc
        await setDoc(doc(db, "users", target.id), {
          displayName: newName || target.displayName,
          phone: newPhone || target.phone,
          photoURL: newPhotoURL,
          status: newStatus || target.status,
          community: newCommunity
        }, { merge: true });
        // If editing self, update profile and password where applicable
        const curr = auth.currentUser;
        if (isSelf && curr) {
          const profilePatch = {};
          if (newName && newName !== curr.displayName) profilePatch.displayName = newName;
          if (newPhotoURL && newPhotoURL !== curr.photoURL) profilePatch.photoURL = newPhotoURL;
          if (Object.keys(profilePatch).length) {
            try {
              await updateProfile(curr, profilePatch);
            } catch (err) {
              if (err && err.code === "auth/requires-recent-login") {
                const cp = window.prompt("請輸入目前密碼以完成更新");
                if (cp) {
                  try {
                    const cred = EmailAuthProvider.credential(curr.email, cp);
                    await reauthenticateWithCredential(curr, cred);
                    await updateProfile(curr, profilePatch);
                  } catch {
                    showHint("重新驗證失敗，請重新登入後再試", "error");
                  }
                } else {
                  showHint("未提供目前密碼，無法更新", "error");
                }
              }
            }
          }
          if (newPassword && newPassword.length >= 6) {
            try {
              await updatePassword(curr, newPassword);
              showHint("密碼已更新", "success");
            } catch (err) {
              if (err && err.code === "auth/requires-recent-login") {
                const cp = window.prompt("請輸入目前密碼以完成更新");
                if (cp) {
                  try {
                    const cred = EmailAuthProvider.credential(curr.email, cp);
                    await reauthenticateWithCredential(curr, cred);
                    await updatePassword(curr, newPassword);
                    showHint("密碼已更新", "success");
                  } catch {
                    showHint("重新驗證失敗，請重新登入後再試", "error");
                  }
                } else {
                  showHint("未提供目前密碼，無法更新", "error");
                }
              } else {
                showHint("密碼更新失敗，可能需要重新登入驗證", "error");
              }
            }
          }
          if (newStatus === "停用") {
            showHint("已標記為停用，將登出目前帳號", "success");
            await signOut(auth);
            redirectAfterSignOut();
            return;
          }
        }
        closeModal();
        await renderSettingsGeneral();
        showHint("已更新帳號資料", "success");
      } catch (e) {
        showHint("更新失敗", "error");
      }
    });
  }
  window.openEditModal = openEditModal;
  
  function openCreateModal() {
    const title = "新增系統管理員";
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="password" id="create-password" placeholder="至少6字元">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-name">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-phone">
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-photo-preview" class="avatar-preview">
          </div>
        </div>
        <div class="modal-foot">
          <button id="create-cancel" class="btn action-btn danger">取消</button>
          <button id="create-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-cancel");
    const btnSave = document.getElementById("create-save");
    const createFile = document.getElementById("create-photo-file");
    const createPreview = document.getElementById("create-photo-preview");
    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) {
        createPreview.src = URL.createObjectURL(f);
      }
    });
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        const email = document.getElementById("create-email").value.trim();
        const password = document.getElementById("create-password").value;
        const displayName = document.getElementById("create-name").value.trim();
        const phone = document.getElementById("create-phone").value.trim();
        const photoFile = document.getElementById("create-photo-file").files[0];
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }
        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "系統管理員",
          status: "啟用",
          displayName,
          phone,
          photoURL,
          createdAt: Date.now()
        }, { merge: true });
        // Set profile on secondary user
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        await renderSettingsGeneral();
        showHint("已建立系統管理員帳號", "success");
      } catch (e) {
        console.error(e);
        showHint("建立失敗，可能權限不足或輸入無效", "error");
      }
    });
  }
  
  function openCreateResidentModal(slug) {
    const title = "新增住戶";
    const seqGuess = (() => {
      try {
        const tbody = document.getElementById("sys-content")?.querySelector("tbody");
        if (tbody) return String(tbody.querySelectorAll("tr").length + 1);
      } catch {}
      return "";
    })();
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-r-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-r-photo-preview" class="avatar-preview">
          </div>
          <div class="modal-row">
            <label>序號</label>
            <input type="text" id="create-r-seq" value="${seqGuess}">
          </div>
          <div class="modal-row">
            <label>戶號</label>
            <input type="text" id="create-r-house-no" placeholder="例如 A-1201">
          </div>
          <div class="modal-row">
            <label>子戶號</label>
            <input type="number" id="create-r-sub-no" placeholder="數字">
          </div>
          <div class="modal-row">
            <label>QR 預覽</label>
            <img id="create-r-qr-preview" class="qr-preview">
          </div>
          <div class="modal-row">
            <label>QR code 代碼</label>
            <input type="text" id="create-r-qr-code" placeholder="輸入QR內容文字">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-r-name">
          </div>
          <div class="modal-row">
            <label>地址</label>
            <input type="text" id="create-r-address" placeholder="住址">
          </div>
          <div class="modal-row">
            <label>坪數</label>
            <input type="number" id="create-r-area" placeholder="例如 35.5">
          </div>
          <div class="modal-row">
            <label>區分權比</label>
            <input type="number" id="create-r-ownership" placeholder="例如 1.5">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-r-phone">
          </div>
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-r-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="text" id="create-r-password" placeholder="至少6字元" value="123456">
          </div>
          <div class="modal-row">
            <label>狀態</label>
            <select id="create-r-status">
              <option value="啟用">啟用</option>
              <option value="停用" selected>停用</option>
            </select>
          </div>
          <div class="hint" id="create-r-hint"></div>
        </div>
        <div class="modal-foot">
          <button id="create-r-cancel" class="btn action-btn danger">取消</button>
          <button id="create-r-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-r-cancel");
    const btnSave = document.getElementById("create-r-save");
    const createFile = document.getElementById("create-r-photo-file");
    const createPreview = document.getElementById("create-r-photo-preview");
    const qrPreview = document.getElementById("create-r-qr-preview");
    const qrCodeInput = document.getElementById("create-r-qr-code");
    const hintEl = document.getElementById("create-r-hint");
    
    const showModalHint = (msg, type="error") => {
        if(hintEl) {
            hintEl.textContent = msg;
            hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
        }
    };

    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) {
        createPreview.src = URL.createObjectURL(f);
      }
    });
    qrCodeInput && qrCodeInput.addEventListener("input", async () => {
      const val = qrCodeInput.value.trim();
      if (!qrPreview) return;
      if (!val) {
        qrPreview.src = "";
      } else {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    });
    (async () => {
      const val = qrCodeInput ? qrCodeInput.value.trim() : "";
      if (qrPreview && val) {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    })();
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        showModalHint(""); 
        const email = document.getElementById("create-r-email").value.trim();
        const password = document.getElementById("create-r-password").value;
        const displayName = document.getElementById("create-r-name").value.trim();
        const phone = document.getElementById("create-r-phone").value.trim();
        const photoFile = document.getElementById("create-r-photo-file").files[0];
        const seq = document.getElementById("create-r-seq").value.trim();
        const houseNo = document.getElementById("create-r-house-no").value.trim();
        const subNoRaw = document.getElementById("create-r-sub-no").value.trim();
        const address = document.getElementById("create-r-address").value.trim();
        const area = document.getElementById("create-r-area").value.trim();
        const ownershipRatio = document.getElementById("create-r-ownership").value.trim();
        const qrCodeText = document.getElementById("create-r-qr-code").value.trim();
        const status = document.getElementById("create-r-status").value;
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showModalHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }
        
        btnSave.disabled = true;
        btnSave.textContent = "建立中...";
        
        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showModalHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showModalHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "住戶",
          status: status || "停用",
          displayName,
          phone,
          photoURL,
          seq,
          houseNo,
          address,
          area,
          ownershipRatio,
          qrCodeText,
          ...(subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        await renderSettingsResidents();
        showHint("已建立住戶帳號", "success");
      } catch (e) {
        console.error(e);
        let msg = "建立失敗";
        if (e.code === 'auth/email-already-in-use') msg = "該 Email 已被使用";
        else if (e.code === 'auth/invalid-email') msg = "Email 格式不正確";
        else if (e.code === 'auth/weak-password') msg = "密碼強度不足";
        else if (e.message) msg += ": " + e.message;
        
        showModalHint(msg, "error");
      } finally {
        if(btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = "建立";
        }
      }
    });
  }
  window.openCreateResidentModal = openCreateResidentModal;
  
  async function renderSettingsResidents() {
    if (!sysNav.content) return;
    const u = auth.currentUser;
    const slug = u ? await getUserCommunity(u.uid) : "default";
    let selectedSlug = window.currentResidentsSlug || slug;
    let cname = selectedSlug;
    let communities = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    if (selectedSlug === "default" && communities.length > 0) {
      selectedSlug = communities[0].id;
      cname = communities[0].name || selectedSlug;
    }
    if (!communities.length) {
      communities = [{ id: selectedSlug, name: selectedSlug }];
    }
    try {
      const csnap = await getDoc(doc(db, "communities", selectedSlug));
      if (csnap.exists()) {
        const c = csnap.data();
        cname = c.name || selectedSlug;
      }
    } catch {}
    let residents = [];
    try {
      const q = query(collection(db, "users"), where("community", "==", selectedSlug));
      const snapList = await getDocs(q);
      residents = snapList.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => (a.role || "住戶") === "住戶");
    } catch {}
    const rows = residents.map((a, idx) => {
      const nm = a.displayName || (a.email || "").split("@")[0] || "住戶";
      const av = a.photoURL
        ? `<img class="avatar" src="${a.photoURL}" alt="avatar">`
        : `<span class="avatar">${(nm || a.email || "住")[0]}</span>`;
      return `
        <tr data-uid="${a.id}">
          <td><input type="checkbox" class="check-resident" value="${a.id}"></td>
          <td class="avatar-cell">${av}</td>
          <td>${a.seq || ""}</td>
          <td>${a.houseNo || ""}</td>
          <td>${typeof a.subNo === "number" ? a.subNo : ""}</td>
          <td>${a.qrCodeText || "—"}</td>
          <td>${nm}</td>
          <td>${a.address || ""}</td>
          <td>${a.area || ""}</td>
          <td>${a.phone || ""}</td>
          <td>${a.email || ""}</td>
          <td>••••••</td>
          <td class="status">${a.status || "停用"}</td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-resident">編輯</button>
          </td>
        </tr>
      `;
    }).join("");
    const emptyText = rows ? "" : "目前沒有住戶資料";
    const options = communities.map(c => `<option value="${c.id}"${c.id === selectedSlug ? " selected" : ""}>${c.name || c.id}</option>`).join("");
    sysNav.content.innerHTML = `
      <div class="card data-card">
        <div class="card-filters">
          <label for="resident-community-select">社區</label>
          <select id="resident-community-select">${options}</select>
        </div>
        <div class="card-head">
          <h1 class="card-title">住戶帳號列表（${cname}）</h1>
          <div style="display:flex;gap:8px;">
            <button id="btn-delete-selected" class="btn small action-btn danger" style="display:none;">刪除選取項目</button>
            <button id="btn-import-resident" class="btn small action-btn">匯入 Excel</button>
            <button id="btn-export-resident" class="btn small action-btn">匯出 Excel</button>
            <button id="btn-create-resident" class="btn small action-btn">新增</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <colgroup>
              <col width="40"><col><col width="70"><col width="100"><col width="80"><col width="120"><col><col><col><col><col><col width="80"><col width="80"><col width="160">
            </colgroup>
            <thead>
              <tr>
                <th><input type="checkbox" id="check-all-residents"></th>
                <th>大頭照</th>
                <th>序號</th>
                <th>戶號</th>
                <th>子戶號</th>
                <th>QR code</th>
                <th>姓名</th>
                <th>地址</th>
                <th>坪數</th>
                <th>手機號碼</th>
                <th>電子郵件</th>
                <th>密碼</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${emptyText ? `<div class="empty-hint">${emptyText}</div>` : ""}
        </div>
      </div>
    `;
    const sel = document.getElementById("resident-community-select");
    sel && sel.addEventListener("change", async () => {
      window.currentResidentsSlug = sel.value;
      await renderSettingsResidents();
    });
    const btnExport = document.getElementById("btn-export-resident");
    btnExport && btnExport.addEventListener("click", async () => {
      btnExport.disabled = true;
      btnExport.textContent = "匯出中...";
      try {
        await ensureXlsxLib();
        if (!window.XLSX) throw new Error("Excel Library not found");
        const data = residents.map((r) => ({
          "大頭照": r.photoURL || "",
          "序號": r.seq || "",
          "戶號": r.houseNo || "",
          "子戶號": r.subNo !== undefined ? r.subNo : "",
          "QR code": r.qrCodeText || "",
          "姓名": r.displayName || "",
          "地址": r.address || "",
          "坪數": r.area || "",
          "區分權比": r.ownershipRatio || "",
          "手機號碼": r.phone || "",
          "電子郵件": r.email || "",
          "狀態": r.status || "啟用"
        }));
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
        window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
      } catch(e) {
        console.error(e);
        alert("匯出失敗");
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = "匯出 Excel";
      }
    });
    const btnImport = document.getElementById("btn-import-resident");
    btnImport && btnImport.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx, .xls, .csv";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let overlay = document.getElementById("import-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "import-overlay";
          overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
          document.body.appendChild(overlay);
        }
        overlay.style.display = "flex";
        overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
        btnImport.disabled = true;
        btnImport.textContent = "匯入中...";
        try {
          await ensureXlsxLib();
          if (!window.XLSX) throw new Error("Excel Library not found");
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = new Uint8Array(e.target.result);
              const workbook = window.XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
              if (jsonData.length === 0) {
                alert("檔案內容為空");
                overlay.style.display = "none";
                return;
              }
              if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                overlay.style.display = "none";
                return;
              }
              let successCount = 0;
              let failCount = 0;
              const total = jsonData.length;
              const updateProgress = (processed) => {
                 const el = document.getElementById("import-msg");
                 if (el) el.textContent = `匯入中... ${processed} / ${total}`;
              };
              const CHUNK_SIZE = 20; 
              for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                let hasWrites = false;
                const promises = chunk.map(async (row) => {
                    try {
                        const email = (row["電子郵件"] || "").trim();
                        const password = (row["密碼"] || "123456").trim();
                        const displayName = (row["姓名"] || "").trim();
                        const phone = (row["手機號碼"] || "").toString().trim();
                        const seq = (row["序號"] || "").toString().trim();
                        const houseNo = (row["戶號"] || "").toString().trim();
                        const subNoRaw = row["子戶號"];
                        const qrCodeText = (row["QR code"] || "").trim();
                        const address = (row["地址"] || "").trim();
                        const area = (row["坪數"] || "").toString().trim();
                        const ownershipRatio = (row["區分權比"] || "").toString().trim();
                        const status = (row["狀態"] || "停用").trim();
                        const photoURL = (row["大頭照"] || "").trim();
                        if (!email) { failCount++; return null; }
                        let uid = null;
                        try {
                            const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                            uid = cred.user.uid;
                            await updateProfile(cred.user, { displayName, photoURL });
                            await signOut(createAuth);
                        } catch (authErr) {
                            if (authErr.code === 'auth/email-already-in-use') {
                                const qUser = query(collection(db, "users"), where("email", "==", email));
                                const snapUser = await getDocs(qUser);
                                if (!snapUser.empty) uid = snapUser.docs[0].id;
                            }
                            if (!uid) { failCount++; return null; }
                        }
                        if (uid) {
                            const docRef = doc(db, "users", uid);
                            const payload = {
                                email, role: "住戶", status, displayName, phone, photoURL,
                                community: selectedSlug, seq, houseNo,
                                ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                qrCodeText, address, area, ownershipRatio, createdAt: Date.now()
                            };
                            return { docRef, payload };
                        }
                    } catch (err) { failCount++; }
                    return null;
                });
                const results = await Promise.all(promises);
                results.forEach(res => {
                    if (res) {
                        batch.set(res.docRef, res.payload, { merge: true });
                        hasWrites = true;
                        successCount++;
                    }
                });
                if (hasWrites) await batch.commit();
                updateProgress(Math.min(i + CHUNK_SIZE, total));
              }
              overlay.innerHTML = `
                <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                    <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                    <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                    <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                    <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                </div>
              `;
              const closeBtn = document.getElementById("close-overlay-btn");
              if (closeBtn) {
                  closeBtn.onclick = async () => {
                      overlay.style.display = "none";
                      await renderSettingsResidents();
                  };
              }
            } catch (e) {
              console.error(e);
              alert("讀取 Excel 失敗");
              overlay.style.display = "none";
            } finally {
              btnImport.disabled = false;
              btnImport.textContent = "匯入 Excel";
            }
          };
          reader.readAsArrayBuffer(file);
        } catch(e) {
          console.error(e);
          alert("匯入失敗");
          btnImport.disabled = false;
          btnImport.textContent = "匯入 Excel";
          if (overlay) overlay.style.display = "none";
        }
      };
      input.click();
    });
    sysNav.content.addEventListener("change", (e) => {
      if (e.target.id === "check-all-residents") {
        const checked = e.target.checked;
        const checkboxes = sysNav.content.querySelectorAll(".check-resident");
        checkboxes.forEach(cb => cb.checked = checked);
        updateDeleteSelectedBtn();
      } else if (e.target.classList.contains("check-resident")) {
        updateDeleteSelectedBtn();
      }
    });
    function updateDeleteSelectedBtn() {
       const btn = document.getElementById("btn-delete-selected");
       const checked = sysNav.content.querySelectorAll(".check-resident:checked");
       if (btn) {
         if (checked.length > 0) {
           btn.style.display = "inline-block";
           btn.textContent = `刪除選取項目 (${checked.length})`;
         } else {
           btn.style.display = "none";
         }
       }
    }
    const btnDeleteSelected = document.getElementById("btn-delete-selected");
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener("click", async () => {
         const checked = sysNav.content.querySelectorAll(".check-resident:checked");
         if (checked.length === 0) return;
         if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
         btnDeleteSelected.disabled = true;
        btnDeleteSelected.textContent = "刪除中...";
         let successCount = 0;
         let failCount = 0;
         const allIds = Array.from(checked).map(cb => cb.value);
         try {
            const limit = 10;
            const processItem = async (uid) => {
               try {
                 await deleteDoc(doc(db, "users", uid));
                 successCount++;
               } catch (e) {
                 console.error(e);
                 failCount++;
               }
            };
            for (let i=0; i<allIds.length; i+=limit) {
                const chunk = allIds.slice(i, i+limit);
                await Promise.all(chunk.map(processItem));
            }
            alert(`刪除完成\n成功：${successCount}\n失敗：${failCount}`);
            await renderSettingsResidents();
         } catch(e) {
            console.error(e);
            alert("刪除過程發生錯誤");
         } finally {
            btnDeleteSelected.disabled = false;
            btnDeleteSelected.textContent = "刪除選取項目";
            btnDeleteSelected.style.display = "none";
         }
      });
    }
    const btnCreate = document.getElementById("btn-create-resident");
    btnCreate && btnCreate.addEventListener("click", () => openCreateResidentModal(selectedSlug));
    const btnEdits = sysNav.content.querySelectorAll(".btn-edit-resident");
    const btnDeletes = sysNav.content.querySelectorAll(".btn-delete-resident");
    btnEdits.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!sysNav.content) return;
        const tr = btn.closest("tr");
        const targetUid = tr && tr.getAttribute("data-uid");
        const currentUser = auth.currentUser;
        const isSelf = currentUser && currentUser.uid === targetUid;
        let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "住戶", status: "啟用" };
        try {
          const snap = await getDoc(doc(db, "users", targetUid));
          if (snap.exists()) {
            const d = snap.data();
            target.displayName = d.displayName || target.displayName;
            target.email = d.email || target.email;
            target.phone = d.phone || target.phone;
            target.photoURL = d.photoURL || target.photoURL;
            target.status = d.status || target.status;
            target.seq = d.seq;
            target.houseNo = d.houseNo;
            target.subNo = d.subNo;
            target.qrCodeText = d.qrCodeText;
            target.address = d.address;
            target.area = d.area;
            target.ownershipRatio = d.ownershipRatio;
          }
        } catch {}
        openEditModal(target, isSelf);
      });
    });
    btnDeletes.forEach(btn => {
      btn.addEventListener("click", async () => {
        const ok = window.confirm("確定要刪除此住戶帳號嗎？此操作不可恢復。");
        if (!ok) return;
        try {
          const tr = btn.closest("tr");
          const targetUid = tr && tr.getAttribute("data-uid");
          const curr = auth.currentUser;
          if (curr && curr.uid === targetUid) {
            await curr.delete();
            showHint("已刪除目前帳號", "success");
            redirectAfterSignOut();
          } else {
            await setDoc(doc(db, "users", targetUid), { status: "停用" }, { merge: true });
            showHint("已標記該帳號為停用", "success");
            await renderSettingsResidents();
          }
        } catch (err) {
          console.error(err);
          showHint("刪除失敗，可能需要重新登入驗證", "error");
        }
      });
    });
  }
  
  function renderContentFor(mainKey, subLabel) {
    if (!sysNav.content) return;
    sysNav.content.innerHTML = '';
    const sub = (subLabel || '').replace(/\u200B/g, '').trim();
    if (mainKey === 'settings' && sub === '一般') {
      renderSettingsGeneral();
      return;
    }
    if (mainKey === 'settings' && sub === '社區') {
      renderSettingsCommunity();
      return;
    }
    if (mainKey === 'settings' && sub === '住戶') {
      renderSettingsResidents();
      return;
    }
    if (mainKey === 'app') {
      renderAppSubContent(sub || '廣告');
      return;
    }
    sysNav.content.innerHTML = '';
  }
  
  async function renderAppSubContent(sub) {
    if (!sysNav.content) return;
    let options = [`<option value="all">全部</option>`];
    let communities = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      communities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const current = window.currentAppCommunitySlug || "all";
    const opts = communities.map(c => {
      const name = c.name || c.id;
      const sel = c.id === current ? " selected" : "";
      return `<option value="${c.id}"${sel}>${name}</option>`;
    }).join("");
    options = [`<option value="all"${current === "all" ? " selected" : ""}>全部</option>`, opts].filter(Boolean);
    
    // Content Logic based on 'sub'
    let contentHtml = `<div class="empty-hint">尚未建立內容</div>`;
    let adsConfig = { interval: 3, effect: 'slide', loop: 'infinite', nav: true };
    
    if (sub === '廣告') {
      // Fetch data
      let adsData = [];
      
      try {
        const targetSlug = current === 'all' ? 'default' : current;
        const snap = await getDoc(doc(db, `communities/${targetSlug}/app_modules/ads`));
        if (snap.exists()) {
          const d = snap.data();
          adsData = d.items || [];
          if (d.config) adsConfig = { ...adsConfig, ...d.config };
        }
      } catch (e) {
        console.log("Fetch ads failed", e);
      }
      
      // Ensure 10 rows
      const rows = [];
      for (let i = 1; i <= 10; i++) {
        const item = adsData.find(x => x.idx === i) || { idx: i, url: '', type: 'image', autoplay: false };
        const isYoutube = item.type === 'youtube';
        rows.push(`
          <tr data-idx="${i}">
            <td>${i}</td>
            <td>
              <input type="text" class="ad-url-input" value="${item.url}" placeholder="圖片連結或 YouTube 網址">
            </td>
            <td>
              <span class="ad-type-badge ${item.type}">${item.type === 'youtube' ? 'YouTube' : '圖片'}</span>
            </td>
            <td>
              <label class="checkbox-label">
                <input type="checkbox" class="ad-autoplay" ${item.autoplay ? 'checked' : ''} ${!isYoutube ? 'disabled' : ''}>
                <span>自動播放</span>
              </label>
            </td>
          </tr>
        `);
      }

      // Preview HTML (Simulate A3)
      const validItems = adsData.filter(x => x.url).sort((a, b) => a.idx - b.idx);
      let previewContent = '';
      if (validItems.length === 0) {
        previewContent = `<div class="preview-placeholder">A3 輪播預覽區 (目前無內容)</div>`;
      } else {
        const slides = validItems.map((item, idx) => {
          let content = '';
          if (item.type === 'youtube') {
             let vidId = '';
             try {
               const u = new URL(item.url);
               if (u.hostname.includes('youtube.com')) {
                 vidId = u.searchParams.get('v');
                 if (!vidId && u.pathname.startsWith('/embed/')) {
                   vidId = u.pathname.split('/')[2];
                 } else if (!vidId && u.pathname.startsWith('/live/')) {
                    vidId = u.pathname.split('/')[2];
                 }
               }
               else if (u.hostname.includes('youtu.be')) vidId = u.pathname.slice(1);
             } catch {}
             const origin = window.location.origin;
             const embedUrl = vidId ? `https://www.youtube.com/embed/${vidId}?autoplay=${item.autoplay?1:0}&mute=1&enablejsapi=1&origin=${origin}` : item.url;
             content = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
          } else {
             content = `<img src="${item.url}" alt="Slide ${idx+1}">`;
          }
          return `<div class="preview-slide ${idx===0?'active':''}">${content}</div>`;
        }).join('');
        previewContent = `
            ${slides}
            <button class="preview-nav-btn preview-nav-prev" style="display: ${adsConfig.nav ? 'block' : 'none'}">❮</button>
            <button class="preview-nav-btn preview-nav-next" style="display: ${adsConfig.nav ? 'block' : 'none'}">❯</button>
          `;
      }

      contentHtml = `
        <div class="card data-card preview-card" style="margin-bottom: 24px;">
           <div class="card-head"><h2 class="card-title">A3 輪播預覽</h2></div>
           <div class="a3-preview-container effect-${adsConfig.effect}">
             ${previewContent}
           </div>
        </div>
        <div class="card data-card">
          <div class="card-head">
            <h2 class="card-title" style="white-space: nowrap;">輪播內容設定</h2>
            <button id="btn-save-ads" class="btn primary action-btn">儲存設定</button>
          </div>
          
          <div class="card-filters" style="margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 24px;">
            <div class="filter-group">
              <label for="ads-interval" style="display: block; margin-bottom: 4px; font-weight: 500;">輪播秒數</label>
              <input type="number" id="ads-interval" value="${adsConfig.interval}" min="1" max="60" style="padding: 6px; border: 1px solid var(--border); border-radius: 4px; width: 80px;">
            </div>
            <div class="filter-group">
              <label for="ads-effect" style="display: block; margin-bottom: 4px; font-weight: 500;">圖片轉場動畫方式</label>
              <select id="ads-effect" style="padding: 6px; border: 1px solid var(--border); border-radius: 4px;">
                <option value="slide" ${adsConfig.effect === 'slide' ? 'selected' : ''}>滑動 (Slide)</option>
                <option value="fade" ${adsConfig.effect === 'fade' ? 'selected' : ''}>淡入淡出 (Fade)</option>
                <option value="none" ${adsConfig.effect === 'none' ? 'selected' : ''}>無動畫 (None)</option>
              </select>
            </div>
            <div class="filter-group">
              <label for="ads-loop" style="display: block; margin-bottom: 4px; font-weight: 500;">循環方式</label>
              <select id="ads-loop" style="padding: 6px; border: 1px solid var(--border); border-radius: 4px;">
                <option value="infinite" ${adsConfig.loop === 'infinite' ? 'selected' : ''}>無限循環</option>
                <option value="rewind" ${adsConfig.loop === 'rewind' ? 'selected' : ''}>來回播放</option>
                <option value="once" ${adsConfig.loop === 'once' ? 'selected' : ''}>播放一次停止</option>
              </select>
            </div>
            <div class="filter-group">
              <label style="display: block; margin-bottom: 4px; font-weight: 500;">導航</label>
              <label class="checkbox-label">
                <input type="checkbox" id="ads-nav" ${adsConfig.nav ? 'checked' : ''}>
                <span>顯示左右導航箭頭</span>
              </label>
            </div>
          </div>

          <div class="table-wrap">
            <table class="table">
              <colgroup><col width="60"><col><col width="100"><col width="120"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>圖片或影片位置</th>
                  <th>類型</th>
                  <th>設定</th>
                </tr>
              </thead>
              <tbody>
                ${rows.join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
    else if (sub === '按鈕') {
      let data = { a6: [], a8: [] };
      try {
        const targetSlug = current === 'all' ? 'default' : current;
        const snap = await getDoc(doc(db, `communities/${targetSlug}/app_modules/buttons`));
        if (snap.exists()) {
          const d = snap.data();
          data.a6 = Array.isArray(d.a6) ? d.a6 : [];
          data.a8 = Array.isArray(d.a8) ? d.a8 : [];
        }
      } catch {}
      const buildRows = (items, section) => {
        const rows = [];
        for (let i = 1; i <= 8; i++) {
          const it = items.find(x => x.idx === i) || { idx: i, text: '', link: '', iconUrl: '' };
          rows.push(`
            <tr data-idx="${i}">
              <td>${i}</td>
              <td><input type="text" class="btn-text" value="${it.text || ''}" placeholder="按鈕名稱"></td>
              <td><input type="url" class="btn-link" value="${it.link || ''}" placeholder="https://..."></td>
              <td>
                <div class="icon-cell">
                  <img class="icon-preview" src="${it.iconUrl || ''}">
                  <input type="file" class="icon-file ${section}-icon-file" accept="image/png,image/jpeg">
                </div>
              </td>
            </tr>
          `);
        }
        return rows.join("");
      };
      const a6Rows = buildRows(data.a6, "a6");
      const a8Rows = buildRows(data.a8, "a8");
      contentHtml = `
        <div class="card data-card">
          <div class="card-head">
            <h2 class="card-title">A6 列按鈕設定</h2>
            <button id="btn-save-buttons" class="btn primary action-btn">儲存設定</button>
          </div>
          <div class="table-wrap">
            <table class="table" id="a6-table">
              <colgroup><col width="60"><col><col><col width="180"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>名稱</th>
                  <th>連結</th>
                  <th>圖形</th>
                </tr>
              </thead>
              <tbody>
                ${a6Rows}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card data-card">
          <div class="card-head">
            <h2 class="card-title">A8 列按鈕設定</h2>
          </div>
          <div class="table-wrap">
            <table class="table" id="a8-table">
              <colgroup><col width="60"><col><col><col width="180"></colgroup>
              <thead>
                <tr>
                  <th>序號</th>
                  <th>名稱</th>
                  <th>連結</th>
                  <th>圖形</th>
                </tr>
              </thead>
              <tbody>
                ${a8Rows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    sysNav.content.innerHTML = `
      <div class="card-wrapper">
        <div class="card data-card" style="margin-bottom: 16px;">
          <div class="card-filters">
            <label for="app-community-select">社區選擇</label>
            <select id="app-community-select">${options.join("")}</select>
          </div>
        </div>
        ${contentHtml}
      </div>
    `;

    // Start Preview Carousel
    if (sub === '廣告') {
        // Need to define startCarousel function or include it here.
        // For simplicity, I'll inline a simple starter or call a global one if I append it.
        // But since I'm appending 'loadFrontAds' and 'startFrontCarousel' later, I can reuse 'startFrontCarousel' logic?
        // No, 'startFrontCarousel' is for front.
        // Let's rely on 'renderAppSubContent' refreshing the DOM, but we need JS to run the carousel.
        // I will add the JS logic inside 'if (sub === "廣告")' block below.
    }

    const sel = document.getElementById("app-community-select");
    if (sel) {
      if (!window.currentAppCommunitySlug) {
        window.currentAppCommunitySlug = "all";
        sel.value = "all";
      }
      sel.addEventListener("change", () => {
        window.currentAppCommunitySlug = sel.value;
        renderAppSubContent(sub);
      });
    }
    
    if (sub === '廣告') {
      const btnSave = document.getElementById("btn-save-ads");
      if (btnSave) {
        btnSave.addEventListener("click", async () => {
           const trs = sysNav.content.querySelectorAll("tbody tr");
           const items = [];
           trs.forEach(tr => {
             const idx = parseInt(tr.getAttribute("data-idx"));
             const url = tr.querySelector(".ad-url-input").value.trim();
             const typeEl = tr.querySelector(".ad-type-badge");
             const type = typeEl.textContent === 'YouTube' ? 'youtube' : 'image';
             const autoplay = tr.querySelector(".ad-autoplay").checked;
             if (url) {
               items.push({ idx, url, type, autoplay });
             }
           });
           
           // Get Config
           const config = {
             interval: parseInt(document.getElementById("ads-interval").value) || 3,
             effect: document.getElementById("ads-effect").value,
             loop: document.getElementById("ads-loop").value,
             nav: document.getElementById("ads-nav").checked
           };
           
           try {
             const targetSlug = current === 'all' ? 'default' : current;
             await setDoc(doc(db, `communities/${targetSlug}/app_modules/ads`), { items, config }, { merge: true });
             showHint("設定已儲存", "success");
             // Don't re-render to avoid race conditions and UI reset
             updatePreview();
           } catch(e) {
             console.error(e);
             showHint("儲存失敗", "error");
           }
        });
      }
      
      // Function to refresh preview based on current DOM inputs
      const updatePreview = () => {
         // Clear existing interval immediately to prevent race conditions
         if (window.adsPreviewInterval) {
             clearInterval(window.adsPreviewInterval);
             window.adsPreviewInterval = null;
         }

         // Gather current inputs
         const trs = sysNav.content.querySelectorAll("tbody tr");
         const items = [];
         trs.forEach(tr => {
           const idx = parseInt(tr.getAttribute("data-idx"));
           const url = tr.querySelector(".ad-url-input").value.trim();
           const typeEl = tr.querySelector(".ad-type-badge");
           const type = typeEl.textContent === 'YouTube' ? 'youtube' : 'image';
           const autoplay = tr.querySelector(".ad-autoplay").checked;
           if (url) {
             items.push({ idx, url, type, autoplay });
           }
         });
         
         // Gather config
         const currentConfig = {
             interval: parseInt(document.getElementById("ads-interval")?.value) || 3,
             effect: document.getElementById("ads-effect")?.value || 'slide',
             loop: document.getElementById("ads-loop")?.value || 'infinite',
             nav: document.getElementById("ads-nav")?.checked || false
         };

         const previewContainer = sysNav.content.querySelector(".a3-preview-container");
         if (!previewContainer) return;

         // Capture current active index
         let currentIdx = 0;
         const currentSlides = previewContainer.querySelectorAll(".preview-slide");
         if (currentSlides.length > 0) {
             currentSlides.forEach((s, i) => {
                 if (s.classList.contains('active')) currentIdx = i;
             });
         }

         // Update Effect Class
         previewContainer.className = `a3-preview-container effect-${currentConfig.effect}`;

         // Generate Slides HTML
         const validItems = items.sort((a, b) => a.idx - b.idx);
         let previewContent = '';
         
         if (validItems.length === 0) {
            previewContent = `<div class="preview-placeholder">A3 輪播預覽區 (目前無內容)</div>`;
         } else {
            // Adjust currentIdx if out of bounds
            if (currentIdx >= validItems.length) currentIdx = 0;

            const slidesHtml = validItems.map((item, idx) => {
              let content = '';
              if (item.type === 'youtube') {
                 let vidId = '';
                 try {
                   const u = new URL(item.url);
                   if (u.hostname.includes('youtube.com')) {
                     vidId = u.searchParams.get('v');
                     if (!vidId && u.pathname.startsWith('/embed/')) {
                       vidId = u.pathname.split('/')[2];
                     } else if (!vidId && u.pathname.startsWith('/live/')) {
                        vidId = u.pathname.split('/')[2];
                     }
                   }
                   else if (u.hostname.includes('youtu.be')) vidId = u.pathname.slice(1);
                 } catch {}
                 const origin = window.location.origin;
                 const embedUrl = vidId ? `https://www.youtube.com/embed/${vidId}?autoplay=${item.autoplay?1:0}&mute=1&enablejsapi=1&origin=${origin}` : item.url;
                 content = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
              } else {
                 content = `<img src="${item.url}" alt="Slide ${idx+1}">`;
              }
              const isActive = idx === currentIdx;
              return `<div class="preview-slide ${isActive?'active':''}">${content}</div>`;
            }).join('');
            
            previewContent = `
                ${slidesHtml}
                <button class="preview-nav-btn preview-nav-prev" style="display: ${currentConfig.nav ? 'block' : 'none'}">❮</button>
                <button class="preview-nav-btn preview-nav-next" style="display: ${currentConfig.nav ? 'block' : 'none'}">❯</button>
              `;
         }
         
         previewContainer.innerHTML = previewContent;
         
         // Restart Carousel Logic
         restartCarousel(currentConfig);
      };

      const restartCarousel = (config) => {
          if (window.adsPreviewInterval) {
            clearInterval(window.adsPreviewInterval);
            window.adsPreviewInterval = null;
          }
          
          const previewContainer = sysNav.content.querySelector(".a3-preview-container");
          if (!previewContainer) return;

          const slides = previewContainer.querySelectorAll(".preview-slide");
          const btnPrev = previewContainer.querySelector(".preview-nav-prev");
          const btnNext = previewContainer.querySelector(".preview-nav-next");
          
          if (slides.length <= 1) return;

          let idx = 0;
          // Try to maintain current active slide if possible, or start from 0
          for (let i = 0; i < slides.length; i++) {
             if (slides[i].classList.contains('active')) {
                 idx = i;
                 break;
             }
          }
          
          let direction = 1; 
          const rawInterval = parseInt(config.interval);
          const intervalTime = Math.max((!isNaN(rawInterval) ? rawInterval : 3) * 1000, 2000); // Enforce min 2s
          
          const showSlide = (i) => {
              slides.forEach(s => s.classList.remove('active'));
              if (slides[i]) slides[i].classList.add('active');
          };
          
          // Ensure initial state
          showSlide(idx);

          const next = () => {
              if (config.loop === 'rewind') {
                  if (idx >= slides.length - 1) direction = -1;
                  if (idx <= 0) direction = 1;
                  idx += direction;
              } else if (config.loop === 'once') {
                  if (idx < slides.length - 1) idx++;
                  else {
                      if (window.adsPreviewInterval) {
                          clearInterval(window.adsPreviewInterval);
                          window.adsPreviewInterval = null;
                      }
                      return;
                  }
              } else { 
                  // infinite
                  idx = (idx + 1) % slides.length;
              }
              showSlide(idx);
          };

          const prev = () => {
              if (config.loop === 'once') {
                  if (idx > 0) idx--;
              } else { 
                  idx = (idx - 1 + slides.length) % slides.length;
              }
              showSlide(idx);
          };

          const startTimer = () => {
              if (window.adsPreviewInterval) clearInterval(window.adsPreviewInterval);
              if (config.loop === 'once' && idx >= slides.length - 1) return;
              window.adsPreviewInterval = setInterval(next, intervalTime);
          };
          
          const resetTimer = () => {
              startTimer();
          };

          if (btnNext) {
             btnNext.onclick = (e) => {
                e.preventDefault();
                next();
                resetTimer();
             };
          }
          if (btnPrev) {
             btnPrev.onclick = (e) => {
                e.preventDefault();
                prev();
                resetTimer();
             };
          }

          // Swipe support for preview
          if (previewContainer) {
            let touchStartX = 0;
            let touchEndX = 0;
            previewContainer.addEventListener('touchstart', (e) => {
              if (e.changedTouches && e.changedTouches.length > 0) {
                touchStartX = e.changedTouches[0].screenX;
              }
              if (window.adsPreviewInterval) clearInterval(window.adsPreviewInterval);
            }, { passive: true });
            previewContainer.addEventListener('touchend', (e) => {
              if (e.changedTouches && e.changedTouches.length > 0) {
                touchEndX = e.changedTouches[0].screenX;
                if (touchEndX < touchStartX - 50) next();
                if (touchEndX > touchStartX + 50) prev();
              }
              resetTimer();
            }, { passive: true });
          }

          startTimer();
      };

      // Auto-detect inputs logic (same as before)
      const inputs = sysNav.content.querySelectorAll(".ad-url-input");
      inputs.forEach(input => {
        input.addEventListener("input", (e) => {
           const val = e.target.value.trim();
           const tr = e.target.closest("tr");
           const badge = tr.querySelector(".ad-type-badge");
           const autoCheck = tr.querySelector(".ad-autoplay");
           
           let isYt = false;
           if (val) {
             try {
               const u = new URL(val);
               if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) isYt = true;
             } catch {}
           }
           
           if (isYt) {
             badge.textContent = 'YouTube';
             badge.className = 'ad-type-badge youtube';
             autoCheck.disabled = false;
           } else {
             badge.textContent = '圖片';
             badge.className = 'ad-type-badge image';
             autoCheck.disabled = true;
             autoCheck.checked = false;
           }
           
           // Update Preview Realtime
           updatePreview();
        });
      });
      
      // Also update on checkbox change
      const checks = sysNav.content.querySelectorAll(".ad-autoplay");
      checks.forEach(c => c.addEventListener("change", updatePreview));

      // Also update on config change
      const configInputs = [
          document.getElementById("ads-interval"),
          document.getElementById("ads-effect"),
          document.getElementById("ads-loop"),
          document.getElementById("ads-nav")
      ];
      configInputs.forEach(el => {
          if(el) el.addEventListener("change", updatePreview);
          if(el && el.tagName === 'INPUT' && el.type === 'number') el.addEventListener("input", updatePreview);
      });
      
      // Start Carousel Logic for Admin Preview
      if (window.adsPreviewInterval) clearInterval(window.adsPreviewInterval);
      
      restartCarousel(adsConfig);
    }
    if (sub === '按鈕') {
      const bindPreview = (scope) => {
        const inputs = sysNav.content.querySelectorAll(`.${scope}-icon-file`);
        inputs.forEach(input => {
          input.addEventListener("change", () => {
            const tr = input.closest("tr");
            const img = tr.querySelector(".icon-preview");
            const f = input.files[0];
            if (img) img.src = f ? URL.createObjectURL(f) : "";
          });
        });
      };
      bindPreview("a6");
      bindPreview("a8");
      const btn = document.getElementById("btn-save-buttons");
      if (btn) {
        btn.addEventListener("click", async () => {
          const originalText = btn.textContent;
          btn.disabled = true;
          btn.textContent = "儲存中...";
          const selEl = document.getElementById("app-community-select");
          const targetSlug = (selEl && selEl.value === 'all') ? 'default' : (selEl ? selEl.value : 'default');
          const collect = (tableId) => {
            const trs = sysNav.content.querySelectorAll(`#${tableId} tbody tr`);
            const items = [];
            trs.forEach(tr => {
              const idx = parseInt(tr.getAttribute("data-idx"));
              const text = tr.querySelector(".btn-text").value.trim();
              const link = tr.querySelector(".btn-link").value.trim();
              const fileInput = tr.querySelector(".icon-file");
              items.push({ idx, text, link, fileInput });
            });
            return items;
          };
          const a6Items = collect("a6-table");
          const a8Items = collect("a8-table");
          const uploadIcon = async (section, idx, file) => {
            const ext = file.type === "image/png" ? "png" : "jpg";
            const path = `buttons/${targetSlug}/${section}_${idx}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, file, { contentType: file.type });
            return await getDownloadURL(ref);
          };
          const resultA6 = [];
          const resultA8 = [];
          try {
            for (let it of a6Items) {
              let iconUrl = "";
              const f = it.fileInput.files[0];
              if (f) {
                try {
                  iconUrl = await uploadIcon("a6", it.idx, f);
                } catch {
                  try {
                    iconUrl = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result);
                      reader.onerror = reject;
                      reader.readAsDataURL(f);
                    });
                  } catch {
                    iconUrl = "";
                  }
                }
              } else {
                const prev = it.fileInput.closest("tr").querySelector(".icon-preview").getAttribute("src") || "";
                iconUrl = prev || "";
              }
              if (it.text || it.link || iconUrl) {
                resultA6.push({ idx: it.idx, text: it.text, link: it.link, iconUrl });
              }
            }
            for (let it of a8Items) {
              let iconUrl = "";
              const f = it.fileInput.files[0];
              if (f) {
                try {
                  iconUrl = await uploadIcon("a8", it.idx, f);
                } catch {
                  try {
                    iconUrl = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result);
                      reader.onerror = reject;
                      reader.readAsDataURL(f);
                    });
                  } catch {
                    iconUrl = "";
                  }
                }
              } else {
                const prev = it.fileInput.closest("tr").querySelector(".icon-preview").getAttribute("src") || "";
                iconUrl = prev || "";
              }
              if (it.text || it.link || iconUrl) {
                resultA8.push({ idx: it.idx, text: it.text, link: it.link, iconUrl });
              }
            }
            await setDoc(doc(db, `communities/${targetSlug}/app_modules/buttons`), { a6: resultA6, a8: resultA8 }, { merge: true });
            showHint("設定已儲存", "success");
            btn.textContent = "已儲存";
            const hint = document.createElement("span");
            hint.textContent = "已完成";
            hint.style.cssText = "margin-left:8px;color:#0ea5e9;font-size:13px;";
            btn.parentElement && btn.parentElement.appendChild(hint);
            setTimeout(() => {
              if (hint && hint.parentElement) hint.parentElement.removeChild(hint);
              btn.textContent = originalText;
              btn.disabled = false;
            }, 1500);
          } catch (e) {
            console.error(e);
            showHint("儲存失敗", "error");
            btn.textContent = "儲存失敗";
            setTimeout(() => {
              btn.textContent = originalText;
              btn.disabled = false;
            }, 1200);
          }
        });
      }
    }
  }
  
  function renderSubNav(key) {
    if (!sysNav.subContainer) return;
    const items = sysSubMenus[key] || [];
    sysNav.subContainer.innerHTML = items.map((item, index) => 
      `<button class="sub-nav-item ${index === 0 ? 'active' : ''}" data-label="${item}">${item}</button>`
    ).join('');
    
    const buttons = sysNav.subContainer.querySelectorAll('.sub-nav-item');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const label = (btn.getAttribute('data-label') || btn.textContent || '').replace(/\u200B/g, '').trim();
        renderContentFor(key, label);
      });
    });
    const firstBtn = sysNav.subContainer.querySelector('.sub-nav-item');
    const first = firstBtn && (firstBtn.getAttribute('data-label') || firstBtn.textContent || '').replace(/\u200B/g, '').trim();
    if (first) renderContentFor(key, first);
  
    if (items.length) renderContentFor(key, items[0]);
  }

  function setActiveNav(activeKey) {
    ['home', 'notify', 'settings', 'app'].forEach(key => {
      if (sysNav[key]) {
        if (key === activeKey) {
          sysNav[key].classList.add('active');
        } else {
          sysNav[key].classList.remove('active');
        }
      }
    });
    renderSubNav(activeKey);
  }

  // Event Listeners
  if (sysNav.home) sysNav.home.addEventListener('click', () => setActiveNav('home'));
  if (sysNav.notify) sysNav.notify.addEventListener('click', () => setActiveNav('notify'));
  if (sysNav.settings) sysNav.settings.addEventListener('click', () => setActiveNav('settings'));
  if (sysNav.app) sysNav.app.addEventListener('click', () => setActiveNav('app'));

  // Initialize with Home
  renderSubNav('home');
}

const adminNav = {
  shortcuts: document.getElementById("admin-tab-shortcuts"),
  mail: document.getElementById("admin-tab-mail"),
  facility: document.getElementById("admin-tab-facility"),
  announce: document.getElementById("admin-tab-announce"),
  residents: document.getElementById("admin-tab-residents"),
  others: document.getElementById("admin-tab-others"),
  subContainer: document.getElementById("admin-sub-nav"),
  content: adminStack ? adminStack.querySelector(".row.B3") : null
};

const adminSubMenus = {
  shortcuts: ["通知跑馬燈"],
  mail: ["收件", "取件", "寄放", "設定"],
  facility: ["設定"],
  announce: ["公告", "財報", "修繕", "APP", "設定"],
  residents: ["住戶", "通知", "警報", "設定"],
  others: ["日誌", "班表", "通訊", "巡邏", "設定"]
};

function renderAdminContent(mainKey, subLabel) {
  if (!adminNav.content) return;
  const sub = (subLabel || "").replace(/\u200B/g, "").trim();
  if (mainKey === "shortcuts" && sub === "通知跑馬燈") {
    adminNav.content.innerHTML = `
      <div class="card marquee-card">
        <div class="marquee">
          <div class="marquee-track">
            <span>系統通知：請於本週完成電力設備巡檢。</span>
            <span>住戶公告：元旦活動報名開放中。</span>
            <span>包裹提醒：B棟管理室今日18:00前可領取。</span>
          </div>
        </div>
      </div>
    `;
    const track = adminNav.content.querySelector(".marquee-track");
    if (track) {
      const clone = track.cloneNode(true);
      track.parentNode.appendChild(clone);
    }
    return;
  }
  if (mainKey === "mail") {
    if (sub === "收件") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">收件</h1></div><div class="empty-hint">尚未建立表單</div></div>`;
      return;
    }
    if (sub === "取件") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">取件</h1></div><div class="empty-hint">尚未建立表單</div></div>`;
      return;
    }
    if (sub === "寄放") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">寄放</h1></div><div class="empty-hint">尚未建立表單</div></div>`;
      return;
    }
    if (sub === "設定") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">郵件包裹設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
      return;
    }
  }
  if (mainKey === "facility") {
    adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">設施預約設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
    return;
  }
  if (mainKey === "announce") {
    if (sub === "公告") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">社區公告</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "財報") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">財報</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "修繕") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">修繕</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "APP") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">APP</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "設定") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">公告設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
      return;
    }
  }
  if (mainKey === "residents") {
    if (sub === "住戶") {
      (async () => {
        const cu = auth.currentUser;
        if (!cu) {
          adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">住戶帳號列表</h1></div><div class="empty-hint">請先登入後台</div></div>`;
          return;
        }
        let roleNow = "住戶";
        try {
          roleNow = await getOrCreateUserRole(cu.uid, cu.email);
        } catch {}
        if (roleNow === "停用" || !checkPagePermission(roleNow, window.location.pathname)) {
          adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">住戶帳號列表</h1></div><div class="empty-hint">權限不足</div></div>`;
          return;
        }
        let slug = window.currentAdminCommunitySlug || getSlugFromPath() || getQueryParam("c") || "default";
        if (slug === "default") {
          try {
            const snap = await getDocs(collection(db, "communities"));
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (list.length > 0) {
              slug = list[0].id;
              window.currentAdminCommunitySlug = slug;
            } else if (auth.currentUser) {
              slug = await getUserCommunity(auth.currentUser.uid);
              window.currentAdminCommunitySlug = slug;
            }
          } catch {
            if (auth.currentUser) {
              slug = await getUserCommunity(auth.currentUser.uid);
              window.currentAdminCommunitySlug = slug;
            }
          }
        }
        try {
          const u = auth.currentUser;
          if (u) {
            const usnap = await getDoc(doc(db, "users", u.uid));
            if (usnap.exists()) {
              const r = (usnap.data().role || "住戶");
              if (r !== "系統管理員") {
                const mySlug = await getUserCommunity(u.uid);
                slug = mySlug;
                window.currentAdminCommunitySlug = mySlug;
              }
            }
          }
        } catch {}
        let cname = slug;
        try {
          const csnap = await getDoc(doc(db, "communities", slug));
          if (csnap.exists()) {
            const c = csnap.data();
            cname = c.name || slug;
          }
        } catch {}
        let residents = [];
        let fetchError = null;
        try {
          const communitiesFilter = [slug];
          if (cname && cname !== slug) communitiesFilter.push(cname);
          let snapList;
          if (communitiesFilter.length > 1) {
            const qIn = query(collection(db, "users"), where("community", "in", communitiesFilter), where("role", "==", "住戶"));
            snapList = await getDocs(qIn);
          } else {
            const qEq = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"));
            snapList = await getDocs(qEq);
          }
          residents = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (err) {
          console.error("Fetch residents error:", err);
          try {
            const qFallback = query(collection(db, "users"), where("community", "==", slug), where("role", "==", "住戶"));
            const snapList = await getDocs(qFallback);
            residents = snapList.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch (retryErr) {
             console.error("Retry fetch error:", retryErr);
             if (retryErr.code === 'permission-denied') {
               fetchError = "權限不足：您沒有權限讀取此社區的住戶資料 (Permission Denied)。";
             } else {
               fetchError = "無法載入住戶資料，請檢查網路連線或稍後再試。";
             }
          }
        }
        const rows = residents.map((a, idx) => {
          const nm = a.displayName || (a.email || "").split("@")[0] || "住戶";
          const av = a.photoURL ? `<img class="avatar" src="${a.photoURL}" alt="avatar">` : `<span class="avatar">${(nm || a.email || "住")[0]}</span>`;
          const qrText = a.qrCodeText || "—";
          return `
            <tr data-uid="${a.id}">
              <td><input type="checkbox" class="check-resident" value="${a.id}"></td>
              <td class="avatar-cell">${av}</td>
              <td>${a.seq || ""}</td>
              <td>${a.houseNo || ""}</td>
              <td>${typeof a.subNo === "number" ? a.subNo : ""}</td>
              <td>${qrText}</td>
              <td>${nm}</td>
              <td>${a.address || ""}</td>
              <td>${a.area || ""}</td>
              <td>${a.ownershipRatio || ""}</td>
              <td>${a.phone || ""}</td>
              <td>${a.email || ""}</td>
              <td>••••••</td>
              <td class="status">${a.status || "停用"}</td>
              <td class="actions">
                <button class="btn small action-btn btn-edit-resident">編輯</button>
              </td>
            </tr>
          `;
        }).join("");
        const emptyText = fetchError ? `<span style="color:red">${fetchError}</span>` : "目前沒有住戶資料";
        adminNav.content.innerHTML = `
          <div class="card data-card">
            <div class="card-head">
              <h1 class="card-title">住戶帳號列表（${cname}） · 總數：${residents.length}</h1>
              <div style="display:flex;gap:8px;">
                <button id="btn-delete-selected" class="btn small action-btn danger" style="display:none;">刪除選取項目</button>
                <button id="btn-import-resident" class="btn small action-btn">匯入 Excel</button>
                <button id="btn-export-resident" class="btn small action-btn">匯出 Excel</button>
                <button id="btn-create-resident" class="btn small action-btn">新增</button>
              </div>
            </div>
            <div class="table-wrap">
              <table class="table">
                <colgroup>
                  <col width="40"><col><col width="70"><col width="100"><col width="80"><col width="120"><col><col><col><col><col><col><col width="80"><col width="80"><col width="160">
                </colgroup>
                <thead>
                  <tr>
                    <th><input type="checkbox" id="check-all-residents"></th>
                    <th>大頭照</th>
                    <th>序號</th>
                    <th>戶號</th>
                    <th>子戶號</th>
                    <th>QR code</th>
                    <th>姓名</th>
                    <th>地址</th>
                    <th>坪數</th>
                    <th>區分權比</th>
                    <th>手機號碼</th>
                    <th>電子郵件</th>
                    <th>密碼</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
              ${emptyText ? `<div class="empty-hint">${emptyText}</div>` : ""}
            </div>
          </div>
        `;
        const btnCreate = document.getElementById("btn-create-resident");
        btnCreate && btnCreate.addEventListener("click", () => window.openCreateResidentModal && window.openCreateResidentModal(slug));
        
        const btnExport = document.getElementById("btn-export-resident");
        btnExport && btnExport.addEventListener("click", async () => {
          btnExport.disabled = true;
          btnExport.textContent = "匯出中...";
          try {
            await ensureXlsxLib();
            if (!window.XLSX) throw new Error("Excel Library not found");
            
            const data = residents.map((r, idx) => ({
              "大頭照": r.photoURL || "",
              "序號": r.seq || "",
              "戶號": r.houseNo || "",
              "子戶號": r.subNo !== undefined ? r.subNo : "",
              "QR code": r.qrCodeText || "",
              "姓名": r.displayName || "",
              "地址": r.address || "",
              "坪數": r.area || "",
              "區分權比": r.ownershipRatio || "",
              "手機號碼": r.phone || "",
              "電子郵件": r.email || "",
              "狀態": r.status || "啟用"
            }));
            
            const ws = window.XLSX.utils.json_to_sheet(data);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, "Residents");
            window.XLSX.writeFile(wb, `${cname}_residents_${new Date().toISOString().slice(0,10)}.xlsx`);
          } catch(e) {
            console.error(e);
            alert("匯出失敗");
          } finally {
            btnExport.disabled = false;
            btnExport.textContent = "匯出 Excel";
          }
        });

        const btnImport = document.getElementById("btn-import-resident");
        btnImport && btnImport.addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".xlsx, .xls, .csv";
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Show blocking overlay
            let overlay = document.getElementById("import-overlay");
            if (!overlay) {
              overlay = document.createElement("div");
              overlay.id = "import-overlay";
              overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center;color:#fff;flex-direction:column;font-size:1.2rem;";
              overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
              document.body.appendChild(overlay);
            } else {
              overlay.style.display = "flex";
              overlay.innerHTML = `<div class="spinner"></div><div id="import-msg" style="margin-top:15px;">準備匯入中...</div>`;
            }
            
            btnImport.disabled = true;
            btnImport.textContent = "匯入中...";
            try {
              await ensureXlsxLib();
              if (!window.XLSX) throw new Error("Excel Library not found");
              
              const reader = new FileReader();
              reader.onload = async (e) => {
                try {
                  const data = new Uint8Array(e.target.result);
                  const workbook = window.XLSX.read(data, { type: 'array' });
                  const firstSheetName = workbook.SheetNames[0];
                  const worksheet = workbook.Sheets[firstSheetName];
                  const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                  
                  if (jsonData.length === 0) {
                    alert("檔案內容為空");
                    overlay.style.display = "none";
                    return;
                  }
                  
                  if (!confirm(`即將匯入 ${jsonData.length} 筆資料，確定嗎？`)) {
                    overlay.style.display = "none";
                    return;
                  }

                  let successCount = 0;
                  let failCount = 0;
                  const total = jsonData.length;
                  const updateProgress = (processed) => {
                     const el = document.getElementById("import-msg");
                     if (el) el.textContent = `匯入中... ${processed} / ${total}`;
                  };

                  // Optimized Batch Processing with Concurrency Control
                  // Auth creation can be rate-limited, so we keep concurrency low (e.g., 10)
                  const CHUNK_SIZE = 20; 
                  for (let i = 0; i < total; i += CHUNK_SIZE) {
                    const chunk = jsonData.slice(i, i + CHUNK_SIZE);
                    const batch = writeBatch(db);
                    let hasWrites = false;

                    const promises = chunk.map(async (row) => {
                        try {
                            const email = (row["電子郵件"] || "").trim();
                            const password = (row["密碼"] || "123456").trim();
                            const displayName = (row["姓名"] || "").trim();
                            const phone = (row["手機號碼"] || "").toString().trim();
                            const seq = (row["序號"] || "").toString().trim();
                            const houseNo = (row["戶號"] || "").toString().trim();
                            const subNoRaw = row["子戶號"];
                            const qrCodeText = (row["QR code"] || "").trim();
                            const address = (row["地址"] || "").trim();
                            const area = (row["坪數"] || "").toString().trim();
                            const ownershipRatio = (row["區分權比"] || "").toString().trim();
                            const status = (row["狀態"] || "停用").trim();
                            const photoURL = (row["大頭照"] || "").trim();

                            if (!email) {
                                console.warn("Skipping row without email", row);
                                failCount++;
                                return null;
                            }

                            // Create Auth
                            let uid = null;
                            try {
                                const cred = await createUserWithEmailAndPassword(createAuth, email, password);
                                uid = cred.user.uid;
                                await updateProfile(cred.user, { displayName, photoURL });
                                await signOut(createAuth);
                            } catch (authErr) {
                                if (authErr.code === 'auth/email-already-in-use') {
                                    const qUser = query(collection(db, "users"), where("email", "==", email));
                                    const snapUser = await getDocs(qUser);
                                    if (!snapUser.empty) {
                                        uid = snapUser.docs[0].id;
                                    }
                                }
                                if (!uid) {
                                    console.error("Auth create failed", authErr);
                                    failCount++;
                                    return null;
                                }
                            }
                            
                            if (uid) {
                                const docRef = doc(db, "users", uid);
                                const payload = {
                                    email,
                                    role: "住戶",
                                    status,
                                    displayName,
                                    phone,
                                    photoURL,
                                    community: slug,
                                    seq,
                                    houseNo,
                                    ...(subNoRaw !== undefined && subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
                                    qrCodeText,
                                    address,
                                    area,
                                    ownershipRatio,
                                    createdAt: Date.now()
                                };
                                return { docRef, payload };
                            }
                        } catch (err) {
                            console.error("Import row failed", err);
                            failCount++;
                        }
                        return null;
                    });

                    const results = await Promise.all(promises);
                    results.forEach(res => {
                        if (res) {
                            batch.set(res.docRef, res.payload, { merge: true });
                            hasWrites = true;
                            successCount++;
                        }
                    });

                    if (hasWrites) {
                        await batch.commit();
                    }
                    updateProgress(Math.min(i + CHUNK_SIZE, total));
                  }
                  
                  // Completion UI
                  overlay.innerHTML = `
                    <div style="background:white;color:black;padding:20px;border-radius:8px;text-align:center;min-width:300px;">
                        <h2 style="margin-top:0;color:#333;">匯入完成</h2>
                        <p style="font-size:1.1rem;margin:10px 0;">成功：<span style="color:green;font-weight:bold;">${successCount}</span> 筆</p>
                        <p style="font-size:1.1rem;margin:10px 0;">失敗：<span style="color:red;font-weight:bold;">${failCount}</span> 筆</p>
                        <button id="close-overlay-btn" class="btn action-btn primary" style="margin-top:15px;width:100%;">確定</button>
                    </div>
                  `;
                  const closeBtn = document.getElementById("close-overlay-btn");
                  if (closeBtn) {
                      closeBtn.onclick = () => {
                          overlay.style.display = "none";
                          // Refresh list
                          const btnResidents = document.getElementById("admin-tab-residents");
                          if (btnResidents) btnResidents.click(); 
                      };
                  }
                  
                } catch (e) {
                  console.error(e);
                  alert("讀取 Excel 失敗");
                  overlay.style.display = "none";
                } finally {
                  btnImport.disabled = false;
                  btnImport.textContent = "匯入 Excel";
                }
              };
              reader.readAsArrayBuffer(file);
              
            } catch(e) {
              console.error(e);
              alert("匯入失敗");
              btnImport.disabled = false;
              btnImport.textContent = "匯入 Excel";
              if (overlay) overlay.style.display = "none";
            }
          };
          input.click();
        });

        adminNav.content.addEventListener("change", (e) => {
          if (e.target.id === "check-all-residents") {
            const checked = e.target.checked;
            const checkboxes = adminNav.content.querySelectorAll(".check-resident");
            checkboxes.forEach(cb => cb.checked = checked);
            updateDeleteSelectedBtn();
          } else if (e.target.classList.contains("check-resident")) {
            updateDeleteSelectedBtn();
          }
        });

        function updateDeleteSelectedBtn() {
           const btn = document.getElementById("btn-delete-selected");
           const checked = adminNav.content.querySelectorAll(".check-resident:checked");
           if (btn) {
             if (checked.length > 0) {
               btn.style.display = "inline-block";
               btn.textContent = `刪除選取項目 (${checked.length})`;
             } else {
               btn.style.display = "none";
             }
           }
        }

        const btnDeleteSelected = document.getElementById("btn-delete-selected");
        if (btnDeleteSelected) {
          btnDeleteSelected.addEventListener("click", async () => {
             const checked = adminNav.content.querySelectorAll(".check-resident:checked");
             if (checked.length === 0) return;
             if (!confirm(`確定要刪除選取的 ${checked.length} 位住戶嗎？此操作將永久刪除資料，且無法復原。`)) return;
             
             btnDeleteSelected.disabled = true;
             btnDeleteSelected.textContent = "刪除中...";
             
             let successCount = 0;
             let failCount = 0;
             
             // Use writeBatch for atomic updates (max 500 operations per batch)
             const chunks = [];
             const allIds = Array.from(checked).map(cb => cb.value);
             for (let i = 0; i < allIds.length; i += 500) {
               chunks.push(allIds.slice(i, i + 500));
             }
             
             try {
                const limit = 10;
                
                const processItem = async (uid) => {
                   try {
                     await deleteDoc(doc(db, "users", uid));
                     successCount++;
                   } catch (e) {
                     console.error(e);
                     failCount++;
                   }
                };
                
                // Simple batch processing
                for (let i = 0; i < allIds.length; i += limit) {
                   const batchIds = allIds.slice(i, i + limit);
                   await Promise.all(batchIds.map(uid => processItem(uid)));
                }

                showHint(`已刪除 ${successCount} 筆，失敗 ${failCount} 筆`, "success");
                setActiveAdminNav("residents"); // Reload
             } catch (err) {
               console.error(err);
               showHint("批次刪除發生錯誤", "error");
             } finally {
               if (btnDeleteSelected) {
                 btnDeleteSelected.disabled = false;
                 btnDeleteSelected.textContent = "刪除選取項目";
               }
             }
          });
        }

        adminNav.content.addEventListener("click", async (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          if (btn.id === "btn-create-resident") {
            window.openCreateResidentModal && window.openCreateResidentModal(slug);
            return;
          }
          if (btn.classList.contains("btn-edit-resident")) {
            const tr = btn.closest("tr");
            const targetUid = tr && tr.getAttribute("data-uid");
            const currentUser = auth.currentUser;
            const isSelf = currentUser && currentUser.uid === targetUid;
            let target = { id: targetUid, displayName: "", email: "", phone: "", photoURL: "", role: "住戶", status: "停用" };
            try {
              const snap = await getDoc(doc(db, "users", targetUid));
              if (snap.exists()) {
                const d = snap.data();
                target.displayName = d.displayName || target.displayName;
                target.email = d.email || target.email;
                target.phone = d.phone || target.phone;
                target.photoURL = d.photoURL || target.photoURL;
                target.status = d.status || target.status;
                target.seq = d.seq;
                target.houseNo = d.houseNo || target.houseNo;
                target.subNo = d.subNo;
                target.qrCodeText = d.qrCodeText || target.qrCodeText;
                target.address = d.address || target.address;
                target.area = d.area || target.area;
                target.ownershipRatio = d.ownershipRatio || target.ownershipRatio;
              }
            } catch {}
            window.openEditModal && window.openEditModal(target, isSelf);
            return;
          }
        });
      })();
      return;
    }
    if (sub === "通知") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">住戶通知</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "警報") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">住戶警報</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "設定") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">住戶設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
      return;
    }
  }
  if (mainKey === "others") {
    if (sub === "日誌") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">日誌</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "班表") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">班表</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "通訊") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">通訊</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "巡邏") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">巡邏</h1></div><div class="empty-hint">尚未建立內容</div></div>`;
      return;
    }
    if (sub === "設定") {
      adminNav.content.innerHTML = `<div class="card"><div class="card-head"><h1 class="card-title">其他設定</h1></div><div class="empty-hint">尚未建立設定</div></div>`;
      return;
    }
  }
  adminNav.content.innerHTML = "";
}

function openCommunitySwitchModal() {
  (async () => {
    let items = [];
    try {
      const snap = await getDocs(collection(db, "communities"));
      items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {}
    const current = window.currentAdminCommunitySlug || "";
    const list = items.map(c => `
      <button class="btn action-btn ${c.id === current ? "primary" : ""}" data-slug="${c.id}">${c.name || c.id}</button>
    `).join("");
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">切換社區</div></div>
        <div class="modal-body">
          <div class="modal-row">${list || "<div class='empty-hint'>尚未建立社區</div>"}</div>
        </div>
        <div class="modal-foot">
          <button id="switch-cancel" class="btn action-btn danger">關閉</button>
        </div>
      </div>
    `;
    openModal(body);
    const btns = Array.from(document.querySelectorAll(".modal-body .btn.action-btn"));
    btns.forEach(b => {
      b.addEventListener("click", () => {
        const slug = b.getAttribute("data-slug");
        if (slug) {
          window.currentAdminCommunitySlug = slug;
          closeModal();
          const savedMain = localStorage.getItem("adminActiveMain") || "shortcuts";
          setActiveAdminNav(savedMain);
        }
      });
    });
    const btnCancel = document.getElementById("switch-cancel");
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
  })();
}

async function updateAdminBrandTitle() {
  const el = document.querySelector("#admin-stack .sys-title");
  if (!el) return;
  let slug = window.currentAdminCommunitySlug || getSlugFromPath() || getQueryParam("c") || "default";
  if (slug === "default") {
    try {
      const snap = await getDocs(collection(db, "communities"));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (list.length > 0) slug = list[0].id;
    } catch {}
    if (slug === "default" && auth.currentUser) {
      slug = await getUserCommunity(auth.currentUser.uid);
    }
  }
  let cname = slug;
  try {
    const csnap = await getDoc(doc(db, "communities", slug));
    if (csnap.exists()) {
      const c = csnap.data();
      cname = c.name || slug;
    }
  } catch {}
  el.textContent = `西北e生活 社區後台（${cname}）`;
}
if (!window.openCreateResidentModal) {
  function openCreateResidentModal(slug) {
    const title = "新增住戶";
    const seqGuess = (() => {
      try {
        const tbody = document.querySelector("#admin-stack .row.B3")?.querySelector("tbody");
        if (tbody) return String(tbody.querySelectorAll("tr").length + 1);
      } catch {}
      return "";
    })();
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-r-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-r-photo-preview" class="avatar-preview">
          </div>
          <div class="modal-row">
            <label>序號</label>
            <input type="text" id="create-r-seq" value="${seqGuess}">
          </div>
          <div class="modal-row">
            <label>戶號</label>
            <input type="text" id="create-r-house-no" placeholder="例如 A-1201">
          </div>
          <div class="modal-row">
            <label>子戶號</label>
            <input type="number" id="create-r-sub-no" placeholder="數字">
          </div>
          <div class="modal-row">
            <label>QR 預覽</label>
            <img id="create-r-qr-preview" class="qr-preview">
          </div>
          <div class="modal-row">
            <label>QR code 代碼</label>
            <input type="text" id="create-r-qr-code" placeholder="輸入QR內容文字">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-r-name">
          </div>
          <div class="modal-row">
            <label>地址</label>
            <input type="text" id="create-r-address" placeholder="住址">
          </div>
          <div class="modal-row">
            <label>坪數</label>
            <input type="number" id="create-r-area" placeholder="例如 35.5">
          </div>
          <div class="modal-row">
            <label>區分權比</label>
            <input type="number" id="create-r-ownership" placeholder="例如 1.5">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-r-phone">
          </div>
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-r-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="text" id="create-r-password" placeholder="至少6字元" value="123456">
          </div>
          <div class="modal-row">
            <label>狀態</label>
            <select id="create-r-status">
              <option value="啟用">啟用</option>
              <option value="停用" selected>停用</option>
            </select>
          </div>
          <div class="hint" id="create-r-hint"></div>
        </div>
        <div class="modal-foot">
          <button id="create-r-cancel" class="btn action-btn danger">取消</button>
          <button id="create-r-save" class="btn action-btn">建立</button>
        </div>
      </div>
    `;
    openModal(body);
    const btnCancel = document.getElementById("create-r-cancel");
    const btnSave = document.getElementById("create-r-save");
    const createFile = document.getElementById("create-r-photo-file");
    const createPreview = document.getElementById("create-r-photo-preview");
    const qrPreview = document.getElementById("create-r-qr-preview");
    const qrCodeInput = document.getElementById("create-r-qr-code");
    const hintEl = document.getElementById("create-r-hint");
    
    const showModalHint = (msg, type="error") => {
      if(hintEl) {
        hintEl.textContent = msg;
        hintEl.style.color = type === "error" ? "#b71c1c" : "#0ea5e9";
      }
    };
    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) createPreview.src = URL.createObjectURL(f);
    });
    qrCodeInput && qrCodeInput.addEventListener("input", async () => {
      const val = qrCodeInput.value.trim();
      if (!qrPreview) return;
      if (!val) {
        qrPreview.src = "";
      } else {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    });
    (async () => {
      const val = qrCodeInput ? qrCodeInput.value.trim() : "";
      if (qrPreview && val) {
        const url = await getQrDataUrl(val, 64);
        qrPreview.src = url;
      }
    })();
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        showModalHint(""); 
        const email = document.getElementById("create-r-email").value.trim();
        const password = document.getElementById("create-r-password").value;
        const displayName = document.getElementById("create-r-name").value.trim();
        const phone = document.getElementById("create-r-phone").value.trim();
        const photoFile = document.getElementById("create-r-photo-file").files[0];
        const houseNo = document.getElementById("create-r-house-no").value.trim();
        const subNoRaw = document.getElementById("create-r-sub-no").value.trim();
        const address = document.getElementById("create-r-address").value.trim();
        const area = document.getElementById("create-r-area").value.trim();
        const ownershipRatio = document.getElementById("create-r-ownership").value.trim();
        const qrCodeText = document.getElementById("create-r-qr-code").value.trim();
        const status = document.getElementById("create-r-status").value;
        let photoURL = "";
        if (!email || !password || password.length < 6) {
          showModalHint("請填寫有效的信箱與至少6字元密碼", "error");
          return;
        }
        btnSave.disabled = true;
        btnSave.textContent = "建立中...";
        const cred = await createUserWithEmailAndPassword(createAuth, email, password);
        if (photoFile) {
          try {
            const ext = photoFile.type === "image/png" ? "png" : "jpg";
            const path = `avatars/${cred.user.uid}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, photoFile, { contentType: photoFile.type });
            photoURL = await getDownloadURL(ref);
          } catch (err) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(photoFile);
              });
              photoURL = b64;
              showModalHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
            } catch {
              showModalHint("上傳大頭照失敗，帳號仍已建立", "error");
            }
          }
        }
        await setDoc(doc(db, "users", cred.user.uid), {
          email,
          role: "住戶",
          status: status || "停用",
          displayName,
          phone,
          photoURL,
          houseNo,
          address,
          area,
          ownershipRatio,
          qrCodeText,
          ...(subNoRaw !== "" ? { subNo: parseInt(subNoRaw, 10) } : {}),
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        showHint("已建立住戶帳號", "success");
        const savedMain = localStorage.getItem("adminActiveMain") || "residents";
        setActiveAdminNav(savedMain);
      } catch (e) {
        console.error(e);
        let msg = "建立失敗";
        if (e.code === 'auth/email-already-in-use') msg = "該 Email 已被使用";
        else if (e.code === 'auth/invalid-email') msg = "Email 格式不正確";
        else if (e.code === 'auth/weak-password') msg = "密碼強度不足";
        else if (e.message) msg += ": " + e.message;
        showModalHint(msg, "error");
      } finally {
        if(btnSave) {
          btnSave.disabled = false;
          btnSave.textContent = "建立";
        }
      }
    });
  }
  window.openCreateResidentModal = openCreateResidentModal;
}
if (!window.openEditModal) {
  async function openEditModal(target, isSelf) {
    const isResident = (target.role || "住戶") === "住戶";
    if (isResident) {
      const titleR = "編輯住戶";
      const seqR = target.seq || "";
      const bodyR = `
        <div class="modal-dialog">
          <div class="modal-head"><div class="modal-title">${titleR}</div></div>
          <div class="modal-body">
            <div class="modal-row">
              <label>大頭照</label>
              <input type="file" id="modal-photo-file" accept="image/png,image/jpeg">
            </div>
            <div class="modal-row">
              <label>預覽</label>
              <img id="modal-photo-preview" class="avatar-preview" src="${target.photoURL || ""}">
            </div>
            <div class="modal-row">
              <label>序號</label>
              <input type="text" id="modal-serial" value="${seqR}">
            </div>
            <div class="modal-row">
              <label>戶號</label>
              <input type="text" id="modal-house-no" value="${target.houseNo || ""}">
            </div>
            <div class="modal-row">
              <label>子戶號</label>
              <input type="number" id="modal-sub-no" value="${typeof target.subNo === "number" ? target.subNo : ""}">
            </div>
            <div class="modal-row">
              <label>QR 預覽</label>
              <img id="modal-qr-preview" class="qr-preview" src="">
            </div>
            <div class="modal-row">
              <label>QR code 代碼</label>
              <input type="text" id="modal-qr-code" value="${(target.qrCodeText || "")}">
            </div>
            <div class="modal-row">
              <label>姓名</label>
              <input type="text" id="modal-name" value="${target.displayName || ""}">
            </div>
            <div class="modal-row">
              <label>地址</label>
              <input type="text" id="modal-address" value="${target.address || ""}">
            </div>
            <div class="modal-row">
              <label>坪數</label>
              <input type="number" id="modal-area" value="${target.area || ""}">
            </div>
            <div class="modal-row">
              <label>區分權比</label>
              <input type="number" id="modal-ownership" value="${target.ownershipRatio || ""}">
            </div>
            <div class="modal-row">
              <label>手機號碼</label>
              <input type="tel" id="modal-phone" value="${target.phone || ""}">
            </div>
            <div class="modal-row">
              <label>電子郵件</label>
              <input type="email" id="modal-email" value="${target.email || ""}">
            </div>
            <div class="modal-row">
              <label>新密碼</label>
              <input type="text" id="modal-password" placeholder="至少6字元">
            </div>
            <div class="modal-row">
              <label>狀態</label>
              <select id="modal-status">
                <option value="啟用">啟用</option>
                <option value="停用">停用</option>
              </select>
            </div>
          </div>
          <div class="modal-foot">
            <button id="modal-cancel" class="btn action-btn danger">取消</button>
            <button id="modal-save" class="btn action-btn">儲存</button>
          </div>
        </div>
      `;
      openModal(bodyR);
      const btnCancel = document.getElementById("modal-cancel");
      const btnSave = document.getElementById("modal-save");
      const editFile = document.getElementById("modal-photo-file");
      const editPreview = document.getElementById("modal-photo-preview");
      const statusSelect = document.getElementById("modal-status");
      const editQrPreview = document.getElementById("modal-qr-preview");
      const editQrCodeInput = document.getElementById("modal-qr-code");
      if (editPreview) editPreview.src = target.photoURL || "";
      if (statusSelect) statusSelect.value = target.status || "停用";
      editFile && editFile.addEventListener("change", () => {
        const f = editFile.files[0];
        if (f) editPreview.src = URL.createObjectURL(f);
      });
      editQrCodeInput && editQrCodeInput.addEventListener("input", async () => {
        const val = editQrCodeInput.value.trim();
        if (!editQrPreview) return;
        if (!val) {
          editQrPreview.src = "";
        } else {
          const url = await getQrDataUrl(val, 64);
          editQrPreview.src = url;
        }
      });
      (async () => {
        const val = editQrCodeInput ? editQrCodeInput.value.trim() : "";
        if (editQrPreview && val) {
          const url = await getQrDataUrl(val, 64);
          editQrPreview.src = url;
        }
      })();
      btnCancel && btnCancel.addEventListener("click", () => closeModal());
      btnSave && btnSave.addEventListener("click", async () => {
        try {
          const newName = document.getElementById("modal-name").value.trim();
          const newSeq = document.getElementById("modal-serial").value.trim();
          const newPhone = document.getElementById("modal-phone").value.trim();
          const photoFile = document.getElementById("modal-photo-file").files[0];
          const newPassword = document.getElementById("modal-password").value;
          const newStatus = document.getElementById("modal-status").value;
          const newHouseNo = document.getElementById("modal-house-no").value.trim();
          const newSubNoRaw = document.getElementById("modal-sub-no").value.trim();
          const newSubNo = newSubNoRaw !== "" ? parseInt(newSubNoRaw, 10) : undefined;
          const newAddress = document.getElementById("modal-address").value.trim();
          const newArea = document.getElementById("modal-area").value.trim();
          const newOwnership = document.getElementById("modal-ownership").value.trim();
          const newQrCodeText = document.getElementById("modal-qr-code").value.trim();
          const newEmail = document.getElementById("modal-email").value.trim();
          let newPhotoURL = target.photoURL || "";
          if (photoFile) {
            try {
              const ext = photoFile.type === "image/png" ? "png" : "jpg";
              const path = `avatars/${target.id}.${ext}`;
              const ref = storageRef(storage, path);
              await uploadBytes(ref, photoFile, { contentType: photoFile.type });
              newPhotoURL = await getDownloadURL(ref);
            } catch (err) {
              try {
                const b64 = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(photoFile);
                });
                newPhotoURL = b64;
                showHint("Storage 上傳失敗，已改用內嵌圖片儲存", "error");
              } catch {
                showHint("上傳大頭照失敗，先以原圖進行更新", "error");
              }
            }
          }
          const payload = {
            displayName: newName || target.displayName,
            seq: newSeq,
            phone: newPhone || target.phone,
            photoURL: newPhotoURL,
            status: newStatus || target.status,
            houseNo: newHouseNo || target.houseNo || "",
            address: newAddress || target.address || "",
            qrCodeText: newQrCodeText || target.qrCodeText || "",
            area: newArea || target.area || "",
            ownershipRatio: newOwnership || target.ownershipRatio || "",
            email: newEmail || target.email || ""
          };
          if (newSubNoRaw !== "") payload.subNo = isNaN(newSubNo) ? target.subNo : newSubNo;
          await setDoc(doc(db, "users", target.id), payload, { merge: true });
          const curr = auth.currentUser;
          if (isSelf && curr) {
            const profilePatch = {};
            if (newName && newName !== curr.displayName) profilePatch.displayName = newName;
            if (newPhotoURL && newPhotoURL !== curr.photoURL) profilePatch.photoURL = newPhotoURL;
            if (Object.keys(profilePatch).length) {
              try {
                await updateProfile(curr, profilePatch);
              } catch (err) {
                if (err && err.code === "auth/requires-recent-login") {
                  const cp = window.prompt("請輸入目前密碼以完成更新");
                  if (cp) {
                    try {
                      const cred = EmailAuthProvider.credential(curr.email, cp);
                      await reauthenticateWithCredential(curr, cred);
                      await updateProfile(curr, profilePatch);
                    } catch {}
                  }
                }
              }
            }
            if (newPassword && newPassword.length >= 6) {
              try {
                await updatePassword(curr, newPassword);
              } catch (err) {
                if (err && err.code === "auth/requires-recent-login") {
                  const cp = window.prompt("請輸入目前密碼以完成設定新密碼");
                  if (cp) {
                    try {
                      const cred = EmailAuthProvider.credential(curr.email, cp);
                      await reauthenticateWithCredential(curr, cred);
                      await updatePassword(curr, newPassword);
                    } catch {}
                  }
                }
              }
            }
          }
          closeModal();
          const savedMain = localStorage.getItem("adminActiveMain") || "residents";
          setActiveAdminNav(savedMain);
          showHint("已更新住戶資料", "success");
        } catch (e) {
          showHint("更新失敗", "error");
        }
      });
      return;
    }
  }
  window.openEditModal = openEditModal;
}
function renderAdminSubNav(key) {
  if (!adminNav.subContainer) return;
  const items = adminSubMenus[key] || [];
  adminNav.subContainer.innerHTML = items.map((item, index) => 
    `<button class="sub-nav-item ${index === 0 ? "active" : ""}" data-label="${item}">${item}</button>`
  ).join("");
  const buttons = adminNav.subContainer.querySelectorAll(".sub-nav-item");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const label = (btn.getAttribute("data-label") || btn.textContent || "").replace(/\u200B/g, "").trim();
      localStorage.setItem("adminActiveSub", label);
      renderAdminContent(key, label);
    });
  });
  const savedSub = localStorage.getItem("adminActiveSub");
  const initial = savedSub && items.includes(savedSub) ? savedSub : (items[0] || "");
  if (initial) {
    const targetBtn = Array.from(buttons).find(b => (b.getAttribute("data-label") || b.textContent || "").trim() === initial);
    if (targetBtn) {
      buttons.forEach(b => b.classList.remove("active"));
      targetBtn.classList.add("active");
    }
    renderAdminContent(key, initial);
  } else {
    adminNav.content && (adminNav.content.innerHTML = "");
  }
}

function setActiveAdminNav(activeKey) {
  ["shortcuts", "mail", "facility", "announce", "residents", "others"].forEach(key => {
    const el = adminNav[key];
    if (el) {
      if (key === activeKey) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    }
  });
  localStorage.setItem("adminActiveMain", activeKey);
  renderAdminSubNav(activeKey);
  updateAdminBrandTitle();
}

if (adminNav.subContainer) {
  if (adminNav.shortcuts) adminNav.shortcuts.addEventListener("click", () => setActiveAdminNav("shortcuts"));
  if (adminNav.mail) adminNav.mail.addEventListener("click", () => setActiveAdminNav("mail"));
  if (adminNav.facility) adminNav.facility.addEventListener("click", () => setActiveAdminNav("facility"));
  if (adminNav.announce) adminNav.announce.addEventListener("click", () => setActiveAdminNav("announce"));
  if (adminNav.residents) adminNav.residents.addEventListener("click", () => setActiveAdminNav("residents"));
  if (adminNav.others) adminNav.others.addEventListener("click", () => setActiveAdminNav("others"));
  const savedMain = localStorage.getItem("adminActiveMain");
  const initialMain = savedMain && adminSubMenus[savedMain] ? savedMain : "shortcuts";
  setActiveAdminNav(initialMain);
}

// Front-end Ads Logic
async function loadFrontAds(slug, providedSnap = null) {
  const container = document.querySelector(".row.A3");
  if (!container) return;
  
  // Ensure we clear any existing interval before reloading
  if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);

  try {
    let data = null;
    let snap = providedSnap;
    if (!snap) {
      snap = await getDoc(doc(db, `communities/${slug}/app_modules/ads`));
    }
    if (!snap.exists()) {
       const def = await getDoc(doc(db, `communities/default/app_modules/ads`));
       if (!def.exists()) {
         container.innerHTML = `<div class="section-text">尚無廣告內容</div>`;
         return;
       }
       data = def.data();
    } else {
       data = snap.data();
    }
    const items = data.items || [];
    // Merge defaults to ensure all properties exist even if DB has partial config
    const defaults = { interval: 3, effect: 'slide', loop: 'infinite', nav: true };
    const savedConfig = data.config || {};
    const config = { ...defaults, ...savedConfig };
    
    const validItems = items.filter(x => x.url).sort((a, b) => a.idx - b.idx);
    
    if (validItems.length === 0) {
      container.innerHTML = `<div class="section-text">尚無廣告內容</div>`;
      return;
    }
    
    const slides = validItems.map((item, idx) => {
      let content = '';
      if (item.type === 'youtube') {
         let vidId = '';
         try {
           const u = new URL(item.url);
           if (u.hostname.includes('youtube.com')) {
             vidId = u.searchParams.get('v');
             if (!vidId && u.pathname.startsWith('/embed/')) {
               vidId = u.pathname.split('/')[2];
             } else if (!vidId && u.pathname.startsWith('/live/')) {
                vidId = u.pathname.split('/')[2];
             }
           }
           else if (u.hostname.includes('youtu.be')) vidId = u.pathname.slice(1);
         } catch {}
         const origin = window.location.origin;
         const embedUrl = vidId ? `https://www.youtube.com/embed/${vidId}?autoplay=${item.autoplay?1:0}&mute=1&enablejsapi=1&origin=${origin}` : item.url;
         content = `<iframe src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      } else {
         content = `<img src="${item.url}" alt="Slide ${idx+1}">`;
      }
      return `<div class="preview-slide ${idx===0?'active':''}">${content}</div>`;
    }).join('');
    
    const showNav = (config.nav === true) || (validItems.length > 1);
    container.innerHTML = `
      <div class="a3-preview-container effect-${config.effect}">
        ${slides}
        <button class="preview-nav-btn preview-nav-prev" style="display: ${showNav ? 'block' : 'none'}">❮</button>
        <button class="preview-nav-btn preview-nav-next" style="display: ${showNav ? 'block' : 'none'}">❯</button>
      </div>
    `;
    
    startFrontCarousel(config);
    
  } catch (e) {
    console.error("Load front ads failed", e);
  }
}

function startFrontCarousel(config) {
    if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
    
    const frontContainer = document.querySelector(".row.A3 .a3-preview-container");
    if (!frontContainer) return;

    const slides = frontContainer.querySelectorAll(".preview-slide");
    const btnPrev = frontContainer.querySelector(".preview-nav-prev");
    const btnNext = frontContainer.querySelector(".preview-nav-next");
    
    if (slides.length <= 1) return;

    let idx = 0;
    slides.forEach((s, i) => { if (s.classList.contains('active')) idx = i; });
    
    let direction = 1; 
    const intervalTime = Math.max((parseInt(config.interval) || 3) * 1000, 1000);
    
    const showSlide = (i) => {
        slides.forEach(s => s.classList.remove('active'));
        if (slides[i]) slides[i].classList.add('active');
    };
    
    const next = () => {
        if (config.loop === 'rewind') {
            if (slides.length <= 1) return;
            if (idx >= slides.length - 1) direction = -1;
            if (idx <= 0) direction = 1;
            idx += direction;
        } else if (config.loop === 'once') {
            if (idx < slides.length - 1) idx++;
            else {
                if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
                return;
            }
        } else { 
            idx = (idx + 1) % slides.length;
        }
        showSlide(idx);
    };

    const prev = () => {
        if (config.loop === 'once') {
            if (idx > 0) idx--;
        } else { 
            idx = (idx - 1 + slides.length) % slides.length;
        }
        showSlide(idx);
    };

    if (btnNext) {
       btnNext.onclick = (e) => { e.preventDefault(); next(); resetTimer(); };
    }
    if (btnPrev) {
       btnPrev.onclick = (e) => { e.preventDefault(); prev(); resetTimer(); };
    }

    // Swipe support
    if (frontContainer) {
      let touchStartX = 0;
      let touchEndX = 0;
      frontContainer.addEventListener('touchstart', (e) => {
        if (e.changedTouches && e.changedTouches.length > 0) {
          touchStartX = e.changedTouches[0].screenX;
        }
        if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
      }, { passive: true });
      frontContainer.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches.length > 0) {
          touchEndX = e.changedTouches[0].screenX;
          if (touchEndX < touchStartX - 50) next();
          if (touchEndX > touchStartX + 50) prev();
        }
        resetTimer();
      }, { passive: true });
    }

    const startTimer = () => {
        if (config.loop === 'once' && idx >= slides.length - 1) return;
        window.frontAdsInterval = setInterval(next, intervalTime);
    };
    
    const resetTimer = () => {
        if (window.frontAdsInterval) clearInterval(window.frontAdsInterval);
        startTimer();
    };

    startTimer();
}

async function loadFrontButtons(slug) {
  const a6Btns = document.querySelectorAll(".row.A6 .feature-btn");
  const a8Btns = document.querySelectorAll(".row.A8 .feature-btn");
  if (!a6Btns.length && !a8Btns.length) return;
  try {
    let snap = await getDoc(doc(db, `communities/${slug}/app_modules/buttons`));
    if (!snap.exists()) {
      const def = await getDoc(doc(db, `communities/default/app_modules/buttons`));
      if (!def.exists()) return;
      snap = def;
    }
    const data = snap.data() || {};
    const a6 = Array.isArray(data.a6) ? data.a6 : [];
    const a8 = Array.isArray(data.a8) ? data.a8 : [];
    const applyToButtons = (items, nodeList) => {
      const byIdx = {};
      items.forEach(it => { if (typeof it.idx === "number") byIdx[it.idx] = it; });
      nodeList.forEach((btn, i) => {
        const cfg = byIdx[i + 1] || null;
        const textEl = btn.querySelector(".nav-text");
        const iconEl = btn.querySelector(".nav-icon");
        if (cfg && textEl) textEl.textContent = cfg.text || textEl.textContent;
        if (cfg && cfg.iconUrl) {
          if (iconEl && iconEl.tagName === "IMG") {
            iconEl.src = cfg.iconUrl;
          } else {
            const img = document.createElement("img");
            img.className = "nav-icon";
            img.src = cfg.iconUrl;
            if (iconEl) iconEl.replaceWith(img);
            else btn.prepend(img);
          }
        }
        btn.onclick = null;
        if (cfg && cfg.link) {
          btn.addEventListener("click", () => {
            const url = cfg.link;
            const title = (cfg.text || (textEl && textEl.textContent) || "連結");
            if (url) openLinkView(title, url);
          });
        }
      });
    };
    applyToButtons(a6, a6Btns);
    applyToButtons(a8, a8Btns);
  } catch (e) {
    console.error("Load front buttons failed", e);
  }
}

function openLinkView(title, url) {
  let root = document.getElementById("sys-modal");
  if (!root) {
    root = document.createElement("div");
    root.id = "sys-modal";
    root.className = "modal hidden";
    document.body.appendChild(root);
  }
  const safeTitle = (title || "").replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
  const html = `
    <div class="modal-dialog link-view-dialog">
      <div class="modal-head link-view-head">
        <div class="modal-title link-view-title">${safeTitle}</div>
        <button type="button" id="link-view-close" class="btn link-view-close">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
            <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body link-view-body">
        <iframe class="link-view-iframe" src="${url}" frameborder="0" allow="autoplay; encrypted-media; clipboard-read; clipboard-write; geolocation"></iframe>
      </div>
    </div>
  `;
  openModal(html);
  const closeBtn = document.getElementById("link-view-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeModal());
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escHandler, true);
    }
  };
  document.addEventListener("keydown", escHandler, true);
}

let unsubscribeFrontButtons = null;
function subscribeFrontButtons(slug) {
  if (unsubscribeFrontButtons) {
    try { unsubscribeFrontButtons(); } catch {}
    unsubscribeFrontButtons = null;
  }
  const ref = doc(db, `communities/${slug}/app_modules/buttons`);
  unsubscribeFrontButtons = onSnapshot(ref, () => {
    loadFrontButtons(slug);
  }, (err) => {
    console.error("Front buttons subscribe error", err);
  });
}

let unsubscribeFrontAds = null;
function subscribeFrontAds(slug) {
  if (unsubscribeFrontAds) {
    try { unsubscribeFrontAds(); } catch {}
    unsubscribeFrontAds = null;
  }
  const ref = doc(db, `communities/${slug}/app_modules/ads`);
  unsubscribeFrontAds = onSnapshot(ref, () => {
    loadFrontAds(slug);
  }, (err) => {
    console.error("Front ads subscribe error", err);
  });
}

window.addEventListener("beforeunload", () => {
  if (unsubscribeFrontAds) {
    try { unsubscribeFrontAds(); } catch {}
    unsubscribeFrontAds = null;
  }
  if (unsubscribeFrontButtons) {
    try { unsubscribeFrontButtons(); } catch {}
    unsubscribeFrontButtons = null;
  }

});

function matchInPath(e, selector) {
  const p = (typeof e.composedPath === "function") ? e.composedPath() : [];
  if (Array.isArray(p) && p.length) {
    for (let i = 0; i < p.length; i++) {
      const n = p[i];
      if (n && n.matches && n.matches(selector)) return n;
      if (n && n.closest && n.closest(selector)) return n.closest(selector);
    }
    return null;
  }
  const t = e.target;
  return t && t.closest ? t.closest(selector) : null;
}
async function handleCreateResidentTrigger(e) {
  const btn = matchInPath(e, "#btn-create-resident-admin") || matchInPath(e, "#btn-create-resident");
  if (!btn) return;
  const root = document.getElementById("sys-modal");
  if (root && !root.classList.contains("hidden")) return;
  let slug = getSlugFromPath() || getQueryParam("c") || "default";
  if (slug === "default" && auth.currentUser) {
    slug = await getUserCommunity(auth.currentUser.uid);
  }
  if (window.openCreateResidentModal) {
    window.openCreateResidentModal(slug);
  }
}
document.addEventListener("click", handleCreateResidentTrigger, true);
document.addEventListener("touchend", handleCreateResidentTrigger, { passive: true, capture: true });
