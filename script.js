import { initializeApp }
from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    getDoc,
    setDoc,
    deleteDoc,
    updateDoc,
    doc
}
from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
}
from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

// Firebase configuration (PaintTrack project)
const firebaseConfig = {
  apiKey: "AIzaSyDUH3334qyZ77uDf6GyEQbdfZnnEZZjgg4",
  authDomain: "paint-track-faea3.firebaseapp.com",
  projectId: "paint-track-faea3",
  storageBucket: "paint-track-faea3.firebasestorage.app",
  messagingSenderId: "664594258315",
  appId: "1:664594258315:web:aa8d4b318647a530ae378e",
  measurementId: "G-9RY06T6CWX"
};

// initialize firebase using the configuration above
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// a second connection used only for creating new accounts,
// so the admin who creates the account stays logged in
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);


// ===== ACCOUNTS & ROLES =====
// the logged-in user: { uid, name, email, role }
let currentUser = null;

// role names shown on screen
function roleName(role) {
    if (role == "mother_admin") return "Mother Admin";
    if (role == "admin") return "Admin";
    return "Employee";
}

// what each role is allowed to do
function canManageRecords() {   // edit and delete records
    return currentUser.role == "mother_admin" || currentUser.role == "admin";
}
// Employees may edit only their own records, on the same day they entered them.
// Mother Admin and Admin may edit any record.
function canEditRecord(record) {
    if (canManageRecords()) {
        return true;
    }
    if (record.recordedByUid != currentUser.uid || !record.createdAt) {
        return false;
    }
    let created = new Date(record.createdAt);
    let today = new Date();
    return created.toDateString() == today.toDateString();
}
function canDownload() {        // PDF downloads
    return currentUser.role == "mother_admin" || currentUser.role == "admin";
}
function canBackup() {
    return currentUser.role == "mother_admin" || currentUser.role == "admin";
}
function canRestore() {
    return currentUser.role == "mother_admin";
}
function canManageAccounts() {
    return currentUser.role == "mother_admin" || currentUser.role == "admin";
}

// shows only one of the screens: loading, login, setup or the main system
function showScreen(screenId) {
    document.getElementById("loadingPage").classList.add("hidden");
    document.getElementById("loginPage").classList.add("hidden");
    document.getElementById("setupPage").classList.add("hidden");
    document.getElementById("forgotPage").classList.add("hidden");
    document.getElementById("appPage").classList.add("hidden");
    document.getElementById(screenId).classList.remove("hidden");
}

// true while the Mother Admin account is being created
let settingUp = false;

// runs when the page opens and every time someone logs in or out
onAuthStateChanged(auth, async function(user) {
    // skip while the first-time setup is still saving the account
    if (settingUp) {
        return;
    }

    if (user == null) {
        currentUser = null;
        await showLoginOrSetup();
        return;
    }

    try {
        // get this user's role from the Users collection
        let userDoc = await getDoc(doc(db, "Users", user.uid));

        if (!userDoc.exists()) {
            await signOut(auth);
            setLoginMessage("This account is not registered in PaintTrack.", "error");
            return;
        }

        let data = userDoc.data();

        if (data.status == "disabled") {
            await signOut(auth);
            setLoginMessage("This account has been deactivated. Please contact your admin.", "error");
            return;
        }

        currentUser = {
            uid: user.uid,
            name: data.name,
            email: data.email,
            role: data.role
        };

        startSystem();
    }
    catch (error) {
        console.error(error);
        await signOut(auth);
        setLoginMessage("Error loading your account. Check firebase setting and database", "error");
    }
});

// if no accounts exist yet, show the first-time setup instead of the login
async function showLoginOrSetup() {
    try {
        let users = await getDocs(collection(db, "Users"));
        if (users.size == 0) {
            showScreen("setupPage");
        } else {
            showScreen("loginPage");
        }
    }
    catch (error) {
        console.error(error);
        showScreen("loginPage");
        setLoginMessage("Cannot connect to the database. Check firebase setting.", "error");
    }
}

function setLoginMessage(text, type) {
    let message = document.getElementById("loginMessage");
    message.textContent = text;
    message.className = "message " + type;
}

// turns Firebase error codes into simple messages
function authErrorText(error) {
    if (error.code == "auth/invalid-credential" || error.code == "auth/wrong-password" ||
        error.code == "auth/user-not-found") return "Wrong email or password.";
    if (error.code == "auth/invalid-email") return "Please enter a valid email.";
    if (error.code == "auth/email-already-in-use") return "This email is already used by another account.";
    if (error.code == "auth/weak-password") return "Password must be at least 6 characters.";
    if (error.code == "auth/too-many-requests") return "Too many attempts. Please wait a moment and try again.";
    if (error.code == "auth/operation-not-allowed") return "Email/Password sign-in is not enabled in Firebase.";
    if (error.code == "auth/missing-email") return "Please enter your email.";
    if (error.code == "auth/requires-recent-login") return "Please log out, log in again, and try once more.";
    if (error.code == "auth/network-request-failed") return "No internet connection. Please try again.";
    return "Something went wrong: " + error.message;
}


// ===== LOGIN =====
document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("loginPassword").addEventListener("keydown", function(e) {
    if (e.key == "Enter") login();
});

async function login() {
    let email = document.getElementById("loginEmail").value.trim();
    let password = document.getElementById("loginPassword").value;

    if (email == "" || password == "") {
        setLoginMessage("Please enter your email and password.", "error");
        return;
    }

    let button = document.getElementById("loginButton");
    button.disabled = true;
    button.textContent = "Logging in...";
    setLoginMessage("", "");

    try {
        await signInWithEmailAndPassword(auth, email, password);
        document.getElementById("loginPassword").value = "";
    }
    catch (error) {
        console.error(error);
        setLoginMessage(authErrorText(error), "error");
    }

    button.disabled = false;
    button.textContent = "Log In";
}


// ===== SHOW / HIDE PASSWORD =====
let eyeButtons = document.querySelectorAll(".eye-btn");
for (let i = 0; i < eyeButtons.length; i++) {
    eyeButtons[i].addEventListener("click", function() {
        let input = document.getElementById(this.dataset.target);
        if (input.type == "password") {
            input.type = "text";
            this.classList.add("showing");          // crossed-out eye
            this.title = "Hide password";
            this.setAttribute("aria-label", "Hide password");
        } else {
            input.type = "password";
            this.classList.remove("showing");       // normal eye
            this.title = "Show password";
            this.setAttribute("aria-label", "Show password");
        }
    });
}

// hides all passwords again (used after saving or logging out)
function hideAllPasswords() {
    for (let i = 0; i < eyeButtons.length; i++) {
        document.getElementById(eyeButtons[i].dataset.target).type = "password";
        eyeButtons[i].classList.remove("showing");
        eyeButtons[i].title = "Show password";
        eyeButtons[i].setAttribute("aria-label", "Show password");
    }
}


// ===== FORGOT PASSWORD =====
document.getElementById("forgotLink").addEventListener("click", function() {
    // copy the email from the login form, if typed
    document.getElementById("forgotEmail").value = document.getElementById("loginEmail").value.trim();
    document.getElementById("forgotMessage").textContent = "";
    showScreen("forgotPage");
});

document.getElementById("backToLoginButton").addEventListener("click", function() {
    setLoginMessage("", "");
    showScreen("loginPage");
});

document.getElementById("sendResetButton").addEventListener("click", async function() {
    let email = document.getElementById("forgotEmail").value.trim();
    let message = document.getElementById("forgotMessage");

    if (email == "") {
        message.textContent = "Please enter your email.";
        message.className = "message error";
        return;
    }

    let button = document.getElementById("sendResetButton");
    button.disabled = true;
    button.textContent = "Sending...";

    try {
        await sendPasswordResetEmail(auth, email);
        message.textContent = "If an account uses this email, a reset link has been sent. " +
            "Check your inbox and spam folder, then open the link to create a new password.";
        message.className = "message success";
    }
    catch (error) {
        console.error(error);
        message.textContent = authErrorText(error);
        message.className = "message error";
    }

    button.disabled = false;
    button.textContent = "Send Reset Link";
});


// ===== FIRST-TIME SETUP (creates the Mother Admin) =====
document.getElementById("setupButton").addEventListener("click", createMotherAdmin);

async function createMotherAdmin() {
    let name = document.getElementById("setupName").value.trim();
    let email = document.getElementById("setupEmail").value.trim();
    let password = document.getElementById("setupPassword").value;
    let confirmPassword = document.getElementById("setupConfirm").value;
    let message = document.getElementById("setupMessage");

    if (name == "" || email == "" || password == "") {
        message.textContent = "Please complete all fields.";
        message.className = "message error";
        return;
    }
    if (password != confirmPassword) {
        message.textContent = "Passwords do not match.";
        message.className = "message error";
        return;
    }

    let button = document.getElementById("setupButton");
    button.disabled = true;
    button.textContent = "Creating...";

    try {
        // make sure no account was created in the meantime
        let users = await getDocs(collection(db, "Users"));
        if (users.size > 0) {
            message.textContent = "Setup is already done. Please log in.";
            message.className = "message error";
            showScreen("loginPage");
            return;
        }

        settingUp = true;
        let result = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(doc(db, "Users", result.user.uid), {
            name: name,
            email: email,
            role: "mother_admin",
            status: "active",
            createdBy: "First-time setup",
            createdAt: new Date().toISOString()
        });

        settingUp = false;
        currentUser = { uid: result.user.uid, name: name, email: email, role: "mother_admin" };
        startSystem();
    }
    catch (error) {
        console.error(error);
        settingUp = false;
        message.textContent = authErrorText(error);
        message.className = "message error";
    }
    finally {
        button.disabled = false;
        button.textContent = "Create Mother Admin";
    }
}


// ===== LOGOUT =====
document.getElementById("logoutButton").addEventListener("click", async function() {
    if (!confirm("Log out of PaintTrack?")) {
        return;
    }
    await signOut(auth);
    hideAllPasswords();
    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmNewPassword").value = "";
    document.getElementById("passwordMessage").textContent = "";
    showPage("dashboard", "dashboardBtn");
});


// ===== START THE SYSTEM AFTER LOGIN =====
function startSystem() {
    // user info in the sidebar
    document.getElementById("userName").textContent = currentUser.name;
    let badge = document.getElementById("userRole");
    badge.textContent = roleName(currentUser.role);
    badge.className = "role-badge " + currentUser.role;

    // My Account details
    document.getElementById("profileName").textContent = currentUser.name;
    document.getElementById("profileEmail").textContent = currentUser.email;
    let profileBadge = document.getElementById("profileRole");
    profileBadge.textContent = roleName(currentUser.role);
    profileBadge.className = "role-badge " + currentUser.role;

    // show or hide menus based on the role
    if (canBackup()) {
        document.getElementById("backupBtn").classList.remove("hidden");
    } else {
        document.getElementById("backupBtn").classList.add("hidden");
    }

    if (canDownload()) {
        document.getElementById("pdfButton").classList.remove("hidden");
    } else {
        document.getElementById("pdfButton").classList.add("hidden");
    }

    if (canRestore()) {
        document.getElementById("restoreCard").classList.remove("hidden");
    } else {
        document.getElementById("restoreCard").classList.add("hidden");
    }

    if (canManageAccounts()) {
        document.getElementById("accountsBtn").classList.remove("hidden");
    } else {
        document.getElementById("accountsBtn").classList.add("hidden");
    }

    // account types this user may create
    let roleSelect = document.getElementById("accRole");
    roleSelect.innerHTML = "<option value='employee'>Employee</option>";
    if (currentUser.role == "mother_admin") {
        roleSelect.innerHTML += "<option value='admin'>Admin</option>";
        document.getElementById("accountsSubtitle").textContent =
            "Create and manage Admin and Employee accounts";
    } else {
        document.getElementById("accountsSubtitle").textContent =
            "Create and manage Employee accounts";
    }

    clearForm();
    resetToAddMode();
    showMessage("", "");
    showPage("dashboard", "dashboardBtn");
    showScreen("appPage");

    loadRecords();
    if (canManageAccounts()) {
        loadAccounts();
    }
}


// ===== PAGE NAVIGATION =====
document.getElementById("dashboardBtn").addEventListener("click", function() {
    showPage("dashboard", "dashboardBtn");
});
document.getElementById("addBtn").addEventListener("click", function() {
    showPage("add", "addBtn");
});
document.getElementById("recordsBtn").addEventListener("click", function() {
    showPage("records", "recordsBtn");
});
document.getElementById("backupBtn").addEventListener("click", function() {
    showPage("backup", "backupBtn");
});
document.getElementById("accountsBtn").addEventListener("click", function() {
    showPage("accounts", "accountsBtn");
});
document.getElementById("myAccountBtn").addEventListener("click", function() {
    showPage("myaccount", "myAccountBtn");
});

// ===== MENU BUTTON (phones) =====
document.getElementById("menuToggle").addEventListener("click", function() {
    let sidebar = document.querySelector(".sidebar");
    sidebar.classList.toggle("open");

    if (sidebar.classList.contains("open")) {
        this.innerHTML = "&#10005;";   // X icon
    } else {
        this.innerHTML = "&#9776;";    // menu icon
    }
});

function closeMenu() {
    document.querySelector(".sidebar").classList.remove("open");
    document.getElementById("menuToggle").innerHTML = "&#9776;";
}

function showPage(pageId, buttonId) {
    // block pages the role is not allowed to open
    if (currentUser != null) {
        if (pageId == "backup" && !canBackup()) return;
        if (pageId == "accounts" && !canManageAccounts()) return;
    }

    // hide all pages
    document.getElementById("dashboard").classList.remove("active");
    document.getElementById("add").classList.remove("active");
    document.getElementById("records").classList.remove("active");
    document.getElementById("backup").classList.remove("active");
    document.getElementById("accounts").classList.remove("active");
    document.getElementById("myaccount").classList.remove("active");

    // remove active from all buttons
    document.getElementById("dashboardBtn").classList.remove("active");
    document.getElementById("addBtn").classList.remove("active");
    document.getElementById("recordsBtn").classList.remove("active");
    document.getElementById("backupBtn").classList.remove("active");
    document.getElementById("accountsBtn").classList.remove("active");
    document.getElementById("myAccountBtn").classList.remove("active");

    // show selected page and button
    document.getElementById(pageId).classList.add("active");
    document.getElementById(buttonId).classList.add("active");

    // on phones, close the menu and go back to the top
    closeMenu();
    window.scrollTo(0, 0);
}


// ===== ADD / EDIT PRODUCTION (saves to Firestore) =====
let editingId = "";   // empty = adding a new record, has a value = editing a record
let editingRecord = null;

document.getElementById("Savebutton").addEventListener("click", saveData);
document.getElementById("cancelEditButton").addEventListener("click", cancelEdit);

// shows a green (success) or red (error) message
function showMessage(text, type) {
    let message = document.getElementById("message");
    message.textContent = text;
    message.className = "message " + type;
}

function clearForm() {
    document.getElementById("batchNo").value = "";
    document.getElementById("productName").value = "";
    document.getElementById("paintType").value = "";
    document.getElementById("color").value = "";
    document.getElementById("quantity").value = "";
    document.getElementById("productionDate").value = "";

    // Produced By is always the logged-in account
    if (currentUser != null) {
        document.getElementById("producedBy").value = currentUser.name;
    } else {
        document.getElementById("producedBy").value = "";
    }

    let radios = document.getElementsByName("finish");
    for (let i = 0; i < radios.length; i++) {
        radios[i].checked = false;
    }
}

// puts the form back to "Add" mode
function resetToAddMode() {
    editingId = "";
    editingRecord = null;
    document.getElementById("addTitle").textContent = "Add Production";
    document.getElementById("addSubtitle").textContent = "Record a newly produced paint product";
    document.getElementById("Savebutton").textContent = "Save Production Record";
    document.getElementById("cancelEditButton").classList.add("hidden");
}

function cancelEdit() {
    clearForm();
    resetToAddMode();
    showMessage("", "");
    showPage("records", "recordsBtn");
}

async function saveData() {
    let batchNo = document.getElementById("batchNo").value;
    let productName = document.getElementById("productName").value;
    let paintType = document.getElementById("paintType").value;
    let color = document.getElementById("color").value;
    let quantity = document.getElementById("quantity").value;
    let productionDate = document.getElementById("productionDate").value;
    // Produced By comes from the logged-in account.
    // When editing, it stays as the person who first produced the record.
    let producedBy = currentUser.name;
    if (editingId != "" && editingRecord != null) {
        producedBy = editingRecord.producedBy;
    }

    // get the selected radio button
    let finish = "";
    let finishChecked = document.querySelector('input[name="finish"]:checked');
    if (finishChecked) {
        finish = finishChecked.value;
    }

    if (batchNo.trim() == "" || productName.trim() == "" || paintType == "" ||
        color.trim() == "" || finish == "" || quantity == "" ||
        productionDate == "" || producedBy.trim() == "") {
        showMessage("Please complete all fields", "error");
        return;
    }

    // quantity must be more than zero
    if (Number(quantity) <= 0) {
        showMessage("Quantity must be greater than 0", "error");
        return;
    }

    // batch number must not be used by another record
    for (let i = 0; i < allRecords.length; i++) {
        let sameBatch = String(allRecords[i].batchNo).toLowerCase() == batchNo.trim().toLowerCase();
        if (sameBatch && allRecords[i].id != editingId) {
            showMessage("Batch number " + batchNo.trim() + " already exists", "error");
            return;
        }
    }

    let record = {
        batchNo: batchNo.trim(),
        productName: productName.trim(),
        paintType: paintType,
        color: color.trim(),
        finish: finish,
        quantity: Number(quantity),
        productionDate: productionDate,
        producedBy: producedBy.trim()
    };

    try {
        if (editingId == "") {
            // new record (also saves who recorded it and when)
            record.recordedBy = currentUser.name;
            record.recordedByUid = currentUser.uid;
            record.createdAt = new Date().toISOString();
            await addDoc(collection(db, "Productions"), record);
            showMessage("Production record saved successfully!", "success");
        } else {
            // update the record being edited
            if (!canEditRecord(editingRecord)) {
                showMessage("You can only edit records you entered today.", "error");
                return;
            }
            record.lastEditedBy = currentUser.name;
            await updateDoc(doc(db, "Productions", editingId), record);
            showMessage("Production record updated successfully!", "success");
            resetToAddMode();
        }

        clearForm();
        loadRecords();
    }
    catch (error) {
        console.error(error);
        showMessage("Error saving record. Check firebase setting and database", "error");
    }
}


// ===== EDIT RECORD (loads the record into the form) =====
function editRecord(data) {
    if (!canEditRecord(data)) {
        return;
    }
    editingId = data.id;
    editingRecord = data;

    document.getElementById("batchNo").value = data.batchNo;
    document.getElementById("productName").value = data.productName;
    document.getElementById("paintType").value = data.paintType;
    document.getElementById("color").value = data.color;
    document.getElementById("quantity").value = data.quantity;
    document.getElementById("productionDate").value = data.productionDate;
    document.getElementById("producedBy").value = data.producedBy;

    let radios = document.getElementsByName("finish");
    for (let i = 0; i < radios.length; i++) {
        radios[i].checked = (radios[i].value == data.finish);
    }

    document.getElementById("addTitle").textContent = "Edit Production";
    document.getElementById("addSubtitle").textContent = "Editing batch " + data.batchNo;
    document.getElementById("Savebutton").textContent = "Update Production Record";
    document.getElementById("cancelEditButton").classList.remove("hidden");
    showMessage("", "");

    showPage("add", "addBtn");
}


// ===== LOAD RECORDS FROM FIRESTORE =====
let allRecords = [];     // every record from the database
let shownRecords = [];   // records currently shown in the table (used for PDF)

async function loadRecords() {
    allRecords = [];

    try {
        let snapshot = await getDocs(collection(db, "Productions"));

        snapshot.forEach(function(record) {
            let data = record.data();
            data.id = record.id;
            // make sure the date is a clean "YYYY-MM-DD" text
            data.productionDate = String(data.productionDate || "").trim();
            allRecords.push(data);
        });

        // newest production date first
        allRecords.sort(function(a, b) {
            if (a.productionDate < b.productionDate) return 1;
            if (a.productionDate > b.productionDate) return -1;
            return 0;
        });

        updateDashboard();
        displayRecords();
        document.getElementById("backupCount").textContent = allRecords.length;
    }
    catch (error) {
        console.error(error);
        document.getElementById("recordsList").innerHTML =
            "<tr><td colspan='9' class='empty'>Error loading records. Check firebase setting and database</td></tr>";
    }
}


// ===== DASHBOARD (today, this week, this month) =====
function updateDashboard() {
    // today at 12:00 AM
    let today = new Date();
    today.setHours(0, 0, 0, 0);

    // this week: Monday to Sunday
    let day = today.getDay();               // 0 = Sunday, 1 = Monday ...
    let daysFromMonday = (day == 0) ? 6 : day - 1;
    let monday = new Date(today);
    monday.setDate(today.getDate() - daysFromMonday);
    let sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    let todayRecords = [];
    let todayCount = 0, todayLiters = 0;
    let weekCount = 0, weekLiters = 0;
    let monthCount = 0, monthLiters = 0;
    let totalLiters = 0;

    for (let i = 0; i < allRecords.length; i++) {
        let r = allRecords[i];
        let qty = Number(r.quantity) || 0;
        totalLiters += qty;

        // skip records without a proper date
        if (r.productionDate == "") {
            continue;
        }

        // turn "YYYY-MM-DD" into a date
        let parts = r.productionDate.split("-");
        let recordDate = new Date(parts[0], parts[1] - 1, parts[2]);

        if (recordDate.getTime() == today.getTime()) {
            todayCount++;
            todayLiters += qty;
            todayRecords.push(r);
        }
        if (recordDate >= monday && recordDate <= sunday) {
            weekCount++;
            weekLiters += qty;
        }
        if (recordDate.getMonth() == today.getMonth() &&
            recordDate.getFullYear() == today.getFullYear()) {
            monthCount++;
            monthLiters += qty;
        }
    }

    // numbers
    document.getElementById("todayCount").textContent = todayCount;
    document.getElementById("weekCount").textContent = weekCount;
    document.getElementById("monthCount").textContent = monthCount;
    document.getElementById("totalRecords").textContent = allRecords.length;

    // liters
    document.getElementById("todayLiters").textContent = todayLiters.toLocaleString() + " L produced";
    document.getElementById("weekLiters").textContent = weekLiters.toLocaleString() + " L produced";
    document.getElementById("monthLiters").textContent = monthLiters.toLocaleString() + " L produced";
    document.getElementById("totalLiters").textContent = totalLiters.toLocaleString() + " L produced";

    // date labels
    let shortDate = { month: "short", day: "numeric" };
    document.getElementById("todayLabel").textContent =
        today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    document.getElementById("weekLabel").textContent =
        monday.toLocaleDateString("en-US", shortDate) + " - " + sunday.toLocaleDateString("en-US", shortDate);
    document.getElementById("monthLabel").textContent =
        today.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // ----- Today's Production table -----
    document.getElementById("todayTableLabel").textContent =
        today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
        "  |  " + todayCount + " record(s), " + todayLiters.toLocaleString() + " L";

    let todayTable = document.getElementById("todayList");
    todayTable.innerHTML = "";

    if (todayRecords.length == 0) {
        todayTable.innerHTML = "<tr><td colspan='7' class='empty'>No production recorded today yet.</td></tr>";
    } else {
        for (let i = 0; i < todayRecords.length; i++) {
            let r = todayRecords[i];
            let row = document.createElement("tr");
            row.innerHTML =
                "<td>" + r.batchNo + "</td>" +
                "<td>" + r.productName + "</td>" +
                "<td>" + r.paintType + "</td>" +
                "<td>" + r.color + "</td>" +
                "<td>" + r.finish + "</td>" +
                "<td>" + r.quantity + "</td>" +
                "<td>" + r.producedBy + "</td>";
            todayTable.appendChild(row);
        }
    }

    // ----- Recent Production table (latest 5) -----
    // allRecords is already sorted newest date first
    let recentTable = document.getElementById("recentList");
    recentTable.innerHTML = "";

    if (allRecords.length == 0) {
        recentTable.innerHTML = "<tr><td colspan='8' class='empty'>No production records yet.</td></tr>";
    } else {
        let limit = Math.min(5, allRecords.length);
        for (let i = 0; i < limit; i++) {
            let r = allRecords[i];
            let row = document.createElement("tr");
            row.innerHTML =
                "<td>" + r.batchNo + "</td>" +
                "<td>" + r.productName + "</td>" +
                "<td>" + r.paintType + "</td>" +
                "<td>" + r.color + "</td>" +
                "<td>" + r.finish + "</td>" +
                "<td>" + r.quantity + "</td>" +
                "<td>" + r.productionDate + "</td>" +
                "<td>" + r.producedBy + "</td>";
            recentTable.appendChild(row);
        }
    }
}


// ===== VIEW RECORDS (with start to end date filter) =====
// the table updates as soon as a date is picked or changed
document.getElementById("startDate").addEventListener("change", displayRecords);
document.getElementById("endDate").addEventListener("change", displayRecords);
document.getElementById("startDate").addEventListener("input", displayRecords);
document.getElementById("endDate").addEventListener("input", displayRecords);

document.getElementById("showAllButton").addEventListener("click", function() {
    document.getElementById("startDate").value = "";
    document.getElementById("endDate").value = "";
    displayRecords();
});

// returns the text that describes the selected date range
function getRangeText() {
    let startDate = document.getElementById("startDate").value;
    let endDate = document.getElementById("endDate").value;

    if (startDate == "" && endDate == "") {
        return "All dates";
    } else if (startDate != "" && endDate == "") {
        return "From " + startDate;
    } else if (startDate == "" && endDate != "") {
        return "Up to " + endDate;
    } else if (startDate == endDate) {
        return startDate;
    } else {
        return startDate + " to " + endDate;
    }
}

function displayRecords() {
    let table = document.getElementById("recordsList");
    let startDate = document.getElementById("startDate").value;
    let endDate = document.getElementById("endDate").value;
    table.innerHTML = "";
    shownRecords = [];

    // start date must not be after end date
    if (startDate != "" && endDate != "" && startDate > endDate) {
        document.getElementById("filterInfo").textContent =
            "Start date must be before or the same as the end date.";
        table.innerHTML = "<tr><td colspan='9' class='empty'>Please fix the date range.</td></tr>";
        return;
    }

    // keep only the records inside the date range
    // ("YYYY-MM-DD" text can be compared directly)
    for (let i = 0; i < allRecords.length; i++) {
        let date = allRecords[i].productionDate;

        if (startDate != "" && date < startDate) {
            continue;
        }
        if (endDate != "" && date > endDate) {
            continue;
        }
        shownRecords.push(allRecords[i]);
    }

    // total liters of the shown records
    let liters = 0;
    for (let i = 0; i < shownRecords.length; i++) {
        liters += Number(shownRecords[i].quantity) || 0;
    }

    // info text above the table
    document.getElementById("filterInfo").textContent =
        "Showing: " + getRangeText() + "  |  " + shownRecords.length + " record(s)  |  " +
        liters.toLocaleString() + " L produced";

    if (shownRecords.length == 0) {
        table.innerHTML = "<tr><td colspan='9' class='empty'>No production records found.</td></tr>";
        return;
    }

    for (let i = 0; i < shownRecords.length; i++) {
        let data = shownRecords[i];

        let row = document.createElement("tr");
        row.innerHTML =
            "<td>" + data.batchNo + "</td>" +
            "<td>" + data.productName + "</td>" +
            "<td>" + data.paintType + "</td>" +
            "<td>" + data.color + "</td>" +
            "<td>" + data.finish + "</td>" +
            "<td>" + data.quantity + "</td>" +
            "<td>" + data.productionDate + "</td>" +
            "<td>" + data.producedBy + "</td>";

        let actionCell = document.createElement("td");

        // edit button (admins: any record, employees: own records entered today)
        if (canEditRecord(data)) {
            let editButton = document.createElement("button");
            editButton.textContent = "Edit";
            editButton.className = "btn-edit";
            editButton.addEventListener("click", function() {
                editRecord(data);
            });
            actionCell.appendChild(editButton);
        }

        // delete button (Mother Admin and Admin only)
        if (canManageRecords()) {
            let deleteButton = document.createElement("button");
            deleteButton.textContent = "Delete";
            deleteButton.className = "btn-delete";
            deleteButton.addEventListener("click", function() {
                deleteRecord(data.id);
            });
            actionCell.appendChild(deleteButton);
        }

        // nothing allowed
        if (actionCell.children.length == 0) {
            actionCell.innerHTML = "<span class='locked'>View only</span>";
        }

        row.appendChild(actionCell);

        table.appendChild(row);
    }
}


// ===== DELETE RECORD =====
async function deleteRecord(id) {
    if (!canManageRecords()) {
        return;
    }
    if (!confirm("Are you sure you want to delete this record?")) {
        return;
    }

    try {
        await deleteDoc(doc(db, "Productions", id));
        loadRecords();
    }
    catch (error) {
        console.error(error);
        alert("Error deleting record.");
    }
}


// ===== DOWNLOAD PDF =====
document.getElementById("pdfButton").addEventListener("click", downloadPDF);

// load logo.png so it can be placed in the PDF
let logoData = "";

function loadLogo() {
    fetch("logo.png")
        .then(function(response) {
            return response.blob();
        })
        .then(function(blob) {
            let reader = new FileReader();
            reader.onload = function() {
                logoData = reader.result;
            };
            reader.readAsDataURL(blob);
        })
        .catch(function(error) {
            console.log("Logo not loaded for PDF:", error);
        });
}

loadLogo();

function downloadPDF() {
    if (!canDownload()) {
        alert("Your account is not allowed to download files.");
        return;
    }

    if (shownRecords.length == 0) {
        alert("No records to download.");
        return;
    }

    const { jsPDF } = window.jspdf;
    let pdf = new jsPDF("landscape");
    let startDate = document.getElementById("startDate").value;
    let endDate = document.getElementById("endDate").value;

    // total liters of the shown records
    let liters = 0;
    for (let i = 0; i < shownRecords.length; i++) {
        liters += Number(shownRecords[i].quantity) || 0;
    }

    // logo (logo.png is about 5:3, so 45 x 27)
    if (logoData != "") {
        pdf.addImage(logoData, "PNG", 14, 8, 45, 27);
    } else {
        // backup text if the logo could not be loaded
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(20);
        pdf.setTextColor(11, 31, 79);
        pdf.text("7CM PaintTrack", 14, 24);
    }

    // header text beside the logo
    pdf.setTextColor(11, 31, 79);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Paint Production Records", 66, 19);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(116, 125, 140);
    pdf.text("Paint Production Record System", 66, 26);

    // orange line under the header
    pdf.setDrawColor(245, 158, 11);
    pdf.setLineWidth(0.8);
    pdf.line(14, 39, 283, 39);

    // details
    pdf.setTextColor(11, 31, 79);
    pdf.setFontSize(10);
    pdf.text("Production Date: " + getRangeText(), 14, 47);
    pdf.text("Total Records: " + shownRecords.length + "     Total Liters: " + liters.toLocaleString() + " L", 14, 53);
    pdf.text("Generated: " + new Date().toLocaleString(), 14, 59);

    // table rows
    let rows = [];
    for (let i = 0; i < shownRecords.length; i++) {
        let r = shownRecords[i];
        rows.push([
            r.batchNo,
            r.productName,
            r.paintType,
            r.color,
            r.finish,
            r.quantity,
            r.productionDate,
            r.producedBy
        ]);
    }

    pdf.autoTable({
        startY: 65,
        head: [["Batch No.", "Product Name", "Type", "Color", "Finish", "Qty (L)", "Date", "Produced By"]],
        body: rows,
        headStyles: { fillColor: [11, 31, 79] }
    });

    // file name includes the date range if one is selected
    let fileName = "production-records";
    if (startDate != "") {
        fileName += "_from-" + startDate;
    }
    if (endDate != "") {
        fileName += "_to-" + endDate;
    }
    pdf.save(fileName + ".pdf");
}


// ===== BACKUP =====
document.getElementById("backupButton").addEventListener("click", downloadBackup);

function downloadBackup() {
    let message = document.getElementById("backupMessage");

    if (!canBackup()) {
        return;
    }

    if (allRecords.length == 0) {
        message.textContent = "No records to back up.";
        message.className = "message error";
        return;
    }

    // copy the records without the Firestore id
    let records = [];
    for (let i = 0; i < allRecords.length; i++) {
        let r = allRecords[i];
        records.push({
            batchNo: r.batchNo,
            productName: r.productName,
            paintType: r.paintType,
            color: r.color,
            finish: r.finish,
            quantity: r.quantity,
            productionDate: r.productionDate,
            producedBy: r.producedBy
        });
    }

    let backup = {
        system: "PaintTrack",
        backupDate: new Date().toLocaleString(),
        totalRecords: records.length,
        records: records
    };

    // turn the backup into a file and download it
    let text = JSON.stringify(backup, null, 2);
    let file = new Blob([text], { type: "application/json" });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(file);

    let today = new Date();
    let dateText = today.getFullYear() + "-" +
        String(today.getMonth() + 1).padStart(2, "0") + "-" +
        String(today.getDate()).padStart(2, "0");
    link.download = "painttrack-backup-" + dateText + ".json";

    link.click();
    URL.revokeObjectURL(link.href);

    message.textContent = "Backup downloaded (" + records.length + " records).";
    message.className = "message success";
}


// ===== RESTORE =====
document.getElementById("restoreButton").addEventListener("click", restoreBackup);

function restoreBackup() {
    let message = document.getElementById("restoreMessage");

    if (!canRestore()) {
        message.textContent = "Only the Mother Admin can restore backups.";
        message.className = "message error";
        return;
    }
    let fileInput = document.getElementById("restoreFile");

    if (fileInput.files.length == 0) {
        message.textContent = "Please choose a backup file first.";
        message.className = "message error";
        return;
    }

    let mode = document.querySelector('input[name="restoreMode"]:checked').value;

    // read the file
    let reader = new FileReader();
    reader.onload = async function() {
        let backup;

        // check if the file is a valid PaintTrack backup
        try {
            backup = JSON.parse(reader.result);
        }
        catch (error) {
            message.textContent = "This file is not a valid backup file.";
            message.className = "message error";
            return;
        }

        if (backup.system != "PaintTrack" || !Array.isArray(backup.records)) {
            message.textContent = "This file is not a PaintTrack backup.";
            message.className = "message error";
            return;
        }

        if (mode == "replace") {
            let ok = confirm("This will DELETE all " + allRecords.length +
                " current records and replace them with " + backup.records.length +
                " records from the backup. Continue?");
            if (!ok) {
                return;
            }
        }

        let restoreButton = document.getElementById("restoreButton");
        restoreButton.disabled = true;
        restoreButton.textContent = "Restoring...";
        message.textContent = "Restoring records, please wait...";
        message.className = "message";

        try {
            // batch numbers that already exist
            let usedBatches = [];

            if (mode == "replace") {
                // delete all current records first
                for (let i = 0; i < allRecords.length; i++) {
                    await deleteDoc(doc(db, "Productions", allRecords[i].id));
                }
            } else {
                for (let i = 0; i < allRecords.length; i++) {
                    usedBatches.push(String(allRecords[i].batchNo).toLowerCase());
                }
            }

            let added = 0, skipped = 0, invalid = 0;

            for (let i = 0; i < backup.records.length; i++) {
                let r = backup.records[i];

                // skip records with missing information
                if (!r.batchNo || !r.productName || !r.paintType || !r.color ||
                    !r.finish || !r.productionDate || !r.producedBy || !(Number(r.quantity) > 0)) {
                    invalid++;
                    continue;
                }

                // skip batch numbers that already exist
                let batch = String(r.batchNo).trim().toLowerCase();
                if (usedBatches.includes(batch)) {
                    skipped++;
                    continue;
                }

                await addDoc(collection(db, "Productions"), {
                    batchNo: String(r.batchNo).trim(),
                    productName: String(r.productName).trim(),
                    paintType: r.paintType,
                    color: String(r.color).trim(),
                    finish: r.finish,
                    quantity: Number(r.quantity),
                    productionDate: String(r.productionDate).trim(),
                    producedBy: String(r.producedBy).trim()
                });
                usedBatches.push(batch);
                added++;
            }

            let result = "Restore complete: " + added + " added";
            if (skipped > 0) {
                result += ", " + skipped + " skipped (batch already exists)";
            }
            if (invalid > 0) {
                result += ", " + invalid + " skipped (incomplete)";
            }
            message.textContent = result + ".";
            message.className = "message success";
            fileInput.value = "";
        }
        catch (error) {
            console.error(error);
            message.textContent = "Error restoring records. Check firebase setting and database";
            message.className = "message error";
        }

        restoreButton.disabled = false;
        restoreButton.textContent = "Restore Backup";
        loadRecords();
    };

    reader.readAsText(fileInput.files[0]);
}


// ===== ACCOUNTS =====
document.getElementById("createAccountButton").addEventListener("click", createAccount);

function setAccountMessage(text, type) {
    let message = document.getElementById("accountMessage");
    message.textContent = text;
    message.className = "message " + type;
}

async function createAccount() {
    if (!canManageAccounts()) {
        return;
    }

    let name = document.getElementById("accName").value.trim();
    let email = document.getElementById("accEmail").value.trim();
    let password = document.getElementById("accPassword").value;
    let role = document.getElementById("accRole").value;

    if (name == "" || email == "" || password == "") {
        setAccountMessage("Please complete all fields.", "error");
        return;
    }

    // Admins can only create Employee accounts
    if (role == "admin" && currentUser.role != "mother_admin") {
        setAccountMessage("Only the Mother Admin can create Admin accounts.", "error");
        return;
    }
    if (role != "admin" && role != "employee") {
        setAccountMessage("Invalid account type.", "error");
        return;
    }

    let button = document.getElementById("createAccountButton");
    button.disabled = true;
    button.textContent = "Creating...";

    try {
        // create the login using the second connection
        let result = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        await signOut(secondaryAuth);

        // save the account details and role
        await setDoc(doc(db, "Users", result.user.uid), {
            name: name,
            email: email,
            role: role,
            status: "active",
            createdBy: currentUser.name,
            createdAt: new Date().toISOString()
        });

        setAccountMessage(roleName(role) + " account created for " + name + ".", "success");
        document.getElementById("accName").value = "";
        document.getElementById("accEmail").value = "";
        document.getElementById("accPassword").value = "";
        document.getElementById("accRole").value = "employee";

        loadAccounts();
    }
    catch (error) {
        console.error(error);
        setAccountMessage(authErrorText(error), "error");
    }

    button.disabled = false;
    button.textContent = "Create Account";
}

// can the logged-in user change this account?
function canChangeAccount(account) {
    if (account.id == currentUser.uid) return false;          // not your own account
    if (account.role == "mother_admin") return false;          // Mother Admin is protected
    if (currentUser.role == "mother_admin") return true;       // Mother Admin: admins and employees
    if (currentUser.role == "admin" && account.role == "employee") return true;  // Admin: employees only
    return false;
}

async function loadAccounts() {
    let table = document.getElementById("accountsList");

    try {
        let snapshot = await getDocs(collection(db, "Users"));
        let accounts = [];

        snapshot.forEach(function(userDoc) {
            let data = userDoc.data();
            data.id = userDoc.id;
            accounts.push(data);
        });

        // Mother Admin first, then Admins, then Employees
        let order = { mother_admin: 1, admin: 2, employee: 3 };
        accounts.sort(function(a, b) {
            return order[a.role] - order[b.role];
        });

        document.getElementById("accountsCount").textContent = accounts.length + " account(s)";
        table.innerHTML = "";

        for (let i = 0; i < accounts.length; i++) {
            let account = accounts[i];
            let row = document.createElement("tr");

            let you = (account.id == currentUser.uid) ? " (you)" : "";
            let statusClass = (account.status == "disabled") ? "status-disabled" : "status-active";
            let statusText = (account.status == "disabled") ? "Deactivated" : "Active";

            row.innerHTML =
                "<td>" + account.name + you + "</td>" +
                "<td>" + account.email + "</td>" +
                "<td><span class='role-badge " + account.role + "'>" + roleName(account.role) + "</span></td>" +
                "<td><span class='" + statusClass + "'>" + statusText + "</span></td>";

            let actionCell = document.createElement("td");

            if (canChangeAccount(account)) {
                // activate / deactivate
                let statusButton = document.createElement("button");
                if (account.status == "disabled") {
                    statusButton.textContent = "Activate";
                    statusButton.className = "btn-edit";
                } else {
                    statusButton.textContent = "Deactivate";
                    statusButton.className = "btn-delete";
                }
                statusButton.addEventListener("click", function() {
                    toggleAccountStatus(account);
                });
                actionCell.appendChild(statusButton);

                // send a password reset email to this account
                let resetButton = document.createElement("button");
                resetButton.textContent = "Reset Password";
                resetButton.className = "btn-secondary btn-small";
                resetButton.addEventListener("click", function() {
                    sendAccountReset(account);
                });
                actionCell.appendChild(resetButton);

                // Mother Admin can switch between Admin and Employee
                if (currentUser.role == "mother_admin") {
                    let roleButton = document.createElement("button");
                    roleButton.className = "btn-secondary btn-small";
                    if (account.role == "admin") {
                        roleButton.textContent = "Make Employee";
                    } else {
                        roleButton.textContent = "Make Admin";
                    }
                    roleButton.addEventListener("click", function() {
                        changeAccountRole(account);
                    });
                    actionCell.appendChild(roleButton);
                }
            } else {
                actionCell.innerHTML = "<span class='locked'>No changes allowed</span>";
            }

            row.appendChild(actionCell);
            table.appendChild(row);
        }
    }
    catch (error) {
        console.error(error);
        table.innerHTML = "<tr><td colspan='5' class='empty'>Error loading accounts. Check firebase setting and database</td></tr>";
    }
}

async function toggleAccountStatus(account) {
    if (!canChangeAccount(account)) {
        return;
    }

    let newStatus = (account.status == "disabled") ? "active" : "disabled";
    let action = (newStatus == "disabled") ? "deactivate" : "activate";

    if (!confirm("Are you sure you want to " + action + " " + account.name + "'s account?")) {
        return;
    }

    try {
        await updateDoc(doc(db, "Users", account.id), { status: newStatus });
        setAccountMessage(account.name + "'s account was " + action + "d.", "success");
        loadAccounts();
    }
    catch (error) {
        console.error(error);
        setAccountMessage("Error updating the account.", "error");
    }
}

async function changeAccountRole(account) {
    if (currentUser.role != "mother_admin" || !canChangeAccount(account)) {
        return;
    }

    let newRole = (account.role == "admin") ? "employee" : "admin";

    if (!confirm("Change " + account.name + " to " + roleName(newRole) + "?")) {
        return;
    }

    try {
        await updateDoc(doc(db, "Users", account.id), { role: newRole });
        setAccountMessage(account.name + " is now " + roleName(newRole) + ".", "success");
        loadAccounts();
    }
    catch (error) {
        console.error(error);
        setAccountMessage("Error updating the account.", "error");
    }
}


// sends a "create new password" email to an account the user manages
async function sendAccountReset(account) {
    if (!canChangeAccount(account)) {
        return;
    }
    if (!confirm("Send a password reset link to " + account.email + "?")) {
        return;
    }

    try {
        await sendPasswordResetEmail(auth, account.email);
        setAccountMessage("Password reset link sent to " + account.email + ".", "success");
    }
    catch (error) {
        console.error(error);
        setAccountMessage(authErrorText(error), "error");
    }
}


// ===== MY ACCOUNT: CREATE NEW PASSWORD =====
document.getElementById("changePasswordButton").addEventListener("click", changePassword);

function setPasswordMessage(text, type) {
    let message = document.getElementById("passwordMessage");
    message.textContent = text;
    message.className = "message " + type;
}

async function changePassword() {
    let currentPassword = document.getElementById("currentPassword").value;
    let newPassword = document.getElementById("newPassword").value;
    let confirmNewPassword = document.getElementById("confirmNewPassword").value;

    if (currentPassword == "" || newPassword == "" || confirmNewPassword == "") {
        setPasswordMessage("Please complete all fields.", "error");
        return;
    }
    if (newPassword.length < 6) {
        setPasswordMessage("New password must be at least 6 characters.", "error");
        return;
    }
    if (newPassword != confirmNewPassword) {
        setPasswordMessage("New passwords do not match.", "error");
        return;
    }
    if (newPassword == currentPassword) {
        setPasswordMessage("New password must be different from the current password.", "error");
        return;
    }

    let button = document.getElementById("changePasswordButton");
    button.disabled = true;
    button.textContent = "Saving...";

    try {
        let user = auth.currentUser;

        // confirm the current password first (Firebase requires this)
        let credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        await updatePassword(user, newPassword);

        setPasswordMessage("Your new password has been saved. Use it the next time you log in.", "success");
        document.getElementById("currentPassword").value = "";
        document.getElementById("newPassword").value = "";
        document.getElementById("confirmNewPassword").value = "";
        hideAllPasswords();
    }
    catch (error) {
        console.error(error);
        if (error.code == "auth/invalid-credential" || error.code == "auth/wrong-password") {
            setPasswordMessage("Your current password is wrong.", "error");
        } else {
            setPasswordMessage(authErrorText(error), "error");
        }
    }

    button.disabled = false;
    button.textContent = "Save New Password";
}


// records load after login (see startSystem)