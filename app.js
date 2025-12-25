import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";
import { getFirestore, initializeFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs, query, where, setLogLevel } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

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
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const storage = getStorage(app);
setLogLevel("error");
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
      db: initializeFirestore(tapp, { experimentalForceLongPolling: true, useFetchStreams: true }),
      storage: getStorage(tapp)
    };
  }
  return tenantApps[key];
}
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
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
  const root = document.getElementById("sys-modal");
  if (!root) return;
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
  if (p.includes("sys.html")) {
    location.href = "sys.html";
  } else if (p.includes("admin.html")) {
    location.href = "admin.html";
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
      showHint("登入成功", "success");
      const role = await getOrCreateUserRole(cred.user.uid, cred.user.email);
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

function handleRoleRedirect(role) {
  // Simple role based redirect logic
  if (window.location.pathname.includes("sys.html")) {
      if (role === "系統管理員") {
        toggleAuth(false);
        if (sysStack) sysStack.classList.remove("hidden");
        if (mainContainer) mainContainer.classList.add("hidden");
      } else {
         showHint("權限不足", "error");
         auth.signOut();
      }
      return;
  }
  
  async function renderSettingsResidents() {
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
          <td class="status">${a.status || "啟用"}</td>
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
  
  if (role === "系統管理員") {
    location.href = "sys.html";
  } else if (role === "管理員" || role === "總幹事") {
    location.href = "admin.html"; // Assume admin.html exists and handles its logic
  } else {
    location.href = "front.html";
  }
}

  // Auto login check
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (el.authCard) el.authCard.classList.add("hidden");
      // If we are on specific pages, handle display
      if (window.location.pathname.includes("sys.html")) {
          let role = "住戶";
          try {
            role = await getOrCreateUserRole(user.uid, user.email);
          } catch {}
          if (role === "系統管理員") {
             if (sysStack) sysStack.classList.remove("hidden");
             if (mainContainer) mainContainer.classList.add("hidden");
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
               btn.innerHTML = photo ? `<img class="avatar" src="${photo}" alt="${name}">` : `<span class="avatar">${(name || (u && u.email) || "用")[0]}</span>`;
               btn.addEventListener("click", () => openUserProfileModal());
             }
          } else {
              // Not authorized for this page
              if (el.authCard) el.authCard.classList.remove("hidden");
              if (sysStack) sysStack.classList.add("hidden");
               showHint("權限不足", "error");
          }
  } else if (window.location.pathname.includes("front.html")) {
        const qp = getQueryParam("c");
        const slug = qp || await getUserCommunity(user.uid);
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
        if (titleEl) titleEl.textContent = `${cname} 社區`;
        if (frontStack) frontStack.classList.remove("hidden");
        if (mainContainer) mainContainer.classList.add("hidden");
    } else if (window.location.pathname.includes("admin.html")) {
         // admin logic
    }
    
    if (el.profileEmail) el.profileEmail.textContent = user.email;
    // We can fetch role here if needed for profile card
  } else {
    toggleAuth(true);
  }
});

// Sign out handlers
[btnSignoutFront, btnSignoutAdmin, el.btnSignout].forEach(btn => {
  if (btn) {
    btn.addEventListener("click", async () => {
      await signOut(auth);
      redirectAfterSignOut();
    });
  }
});

// Password toggle
if (btnTogglePassword) {
  btnTogglePassword.addEventListener("click", () => {
    const type = el.password.getAttribute("type") === "password" ? "text" : "password";
    el.password.setAttribute("type", type);
    btnTogglePassword.classList.toggle("visible");
  });
}

// System Admin Page Navigation Logic
const sysNav = {
  home: document.getElementById("sys-nav-home"),
  notify: document.getElementById("sys-nav-notify"),
  settings: document.getElementById("sys-nav-settings"),
  subContainer: document.getElementById("sys-sub-nav"),
  content: document.getElementById("sys-content")
};

const sysSubMenus = {
  home: ["總覽", "社區"],
  notify: ["系統", "社區", "住戶"],
  settings: ["一般", "社區", "住戶", "系統"]
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
    `;
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
      location.href = `front.html?c=${encodeURIComponent(slug)}`;
    }));
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
  
  function openEditModal(target, isSelf) {
    const title = "編輯系統管理員";
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
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
          status: newStatus || target.status
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
    const body = `
      <div class="modal-dialog">
        <div class="modal-head"><div class="modal-title">${title}</div></div>
        <div class="modal-body">
          <div class="modal-row">
            <label>電子郵件</label>
            <input type="text" id="create-r-email" placeholder="example@domain.com">
          </div>
          <div class="modal-row">
            <label>密碼</label>
            <input type="password" id="create-r-password" placeholder="至少6字元">
          </div>
          <div class="modal-row">
            <label>姓名</label>
            <input type="text" id="create-r-name">
          </div>
          <div class="modal-row">
            <label>手機號碼</label>
            <input type="tel" id="create-r-phone">
          </div>
          <div class="modal-row">
            <label>大頭照</label>
            <input type="file" id="create-r-photo-file" accept="image/png,image/jpeg">
          </div>
          <div class="modal-row">
            <label>預覽</label>
            <img id="create-r-photo-preview" class="avatar-preview">
          </div>
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
    createFile && createFile.addEventListener("change", () => {
      const f = createFile.files[0];
      if (f) {
        createPreview.src = URL.createObjectURL(f);
      }
    });
    btnCancel && btnCancel.addEventListener("click", () => closeModal());
    btnSave && btnSave.addEventListener("click", async () => {
      try {
        const email = document.getElementById("create-r-email").value.trim();
        const password = document.getElementById("create-r-password").value;
        const displayName = document.getElementById("create-r-name").value.trim();
        const phone = document.getElementById("create-r-phone").value.trim();
        const photoFile = document.getElementById("create-r-photo-file").files[0];
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
          role: "住戶",
          status: "啟用",
          displayName,
          phone,
          photoURL,
          community: slug,
          createdAt: Date.now()
        }, { merge: true });
        await updateProfile(cred.user, { displayName, photoURL });
        closeModal();
        await renderSettingsResidents();
        showHint("已建立住戶帳號", "success");
      } catch (e) {
        console.error(e);
        showHint("建立失敗，可能權限不足或輸入無效", "error");
      }
    });
  }
  
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
          <td class="status">${a.status || "啟用"}</td>
          <td class="actions">
            <button class="btn small action-btn btn-edit-resident">編輯</button>
            <button class="btn small action-btn danger btn-delete-resident">刪除</button>
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
          <button id="btn-create-resident" class="btn small action-btn">新增</button>
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
          ${emptyText ? `<div class="empty-hint">${emptyText}</div>` : ""}
        </div>
      </div>
    `;
    const sel = document.getElementById("resident-community-select");
    sel && sel.addEventListener("change", async () => {
      window.currentResidentsSlug = sel.value;
      await renderSettingsResidents();
    });
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
    sysNav.content.innerHTML = '';
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
    ['home', 'notify', 'settings'].forEach(key => {
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

  // Initialize with Home
  renderSubNav('home');
}
