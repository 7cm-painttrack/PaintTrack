import { initializeApp }
from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    getDoc,
    setDoc,
    onSnapshot,
    runTransaction,
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


// ===== SAFE TEXT =====
// turns characters like < and > into plain text, so typed text
// can never be read as HTML or code when it is shown in a table
function safe(text) {
    if (text == null) {
        return "";
    }
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// today's date as "YYYY-MM-DD" (the same format the date boxes use)
function todayText() {
    let now = new Date();
    return now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");
}


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
// is this record the logged-in person's own?
// (older records without an account id are matched by name)
function isOwnRecord(record) {
    if (record.recordedByUid) {
        return record.recordedByUid == currentUser.uid;
    }
    return record.producedBy == currentUser.name;
}

// records this person may see: everything for admins, only their own for Employees
function visibleRecords() {
    if (currentUser == null) {
        return [];
    }
    if (currentUser.role == "employee") {
        let own = [];
        for (let i = 0; i < allRecords.length; i++) {
            if (isOwnRecord(allRecords[i])) {
                own.push(allRecords[i]);
            }
        }
        return own;
    }
    return allRecords;
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
        stopWatchingAccount();
        stopRecordsWatch();
        stopProductsWatch();
        stopCounterWatch();
        stopBackupsWatch();
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
        watchMyAccount();
    }
    catch (error) {
        console.error(error);
        await signOut(auth);
        setLoginMessage("Error loading your account. Check firebase setting and database", "error");
    }
});

// watches the logged-in account while the system is open:
// if an admin deactivates it, the person is logged out right away;
// if an admin changes its type, the menus update right away
let stopWatching = null;

function watchMyAccount() {
    if (stopWatching != null) {
        stopWatching();
    }

    stopWatching = onSnapshot(doc(db, "Users", currentUser.uid), async function(userDoc) {
        if (currentUser == null) {
            return;
        }

        if (!userDoc.exists() || userDoc.data().status == "disabled") {
            stopWatchingAccount();
            setLoginMessage("Your account has been deactivated. Please contact your admin.", "error");
            await signOut(auth);
            return;
        }

        // the Mother Admin changed my name: show it right away
        let newName = userDoc.data().name;
        if (newName && newName != currentUser.name) {
            currentUser.name = newName;
            showMyName();
        }

        let newRole = userDoc.data().role;
        if (newRole != currentUser.role) {
            currentUser.role = newRole;
            alert("Your account type was changed to " + roleName(newRole) + ".");
            startSystem();
        }
    });
}

// puts the logged-in name everywhere it is shown
function showMyName() {
    document.getElementById("userName").textContent = currentUser.name;
    document.getElementById("profileName").textContent = currentUser.name;
    // Produced By on the form (not while editing someone's record)
    if (editingId == "") {
        document.getElementById("producedBy").value = currentUser.name;
    }
}

function stopWatchingAccount() {
    if (stopWatching != null) {
        stopWatching();
        stopWatching = null;
    }
}

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
document.getElementById("loginEmail").addEventListener("keydown", function(e) {
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
        watchMyAccount();
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
    await releaseLock();
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

    // dashboard and records wording: Employees see only their own production
    let isEmployee = (currentUser.role == "employee");
    document.getElementById("dashSubtitle").textContent = isEmployee ?
        "Your own paint production" : "Overview of paint production records";
    document.getElementById("todayCardLabel").textContent = isEmployee ? "My Production Today" : "Produced Today";
    document.getElementById("weekCardLabel").textContent = isEmployee ? "My Production This Week" : "Produced This Week";
    document.getElementById("monthCardLabel").textContent = isEmployee ? "My Production This Month" : "Produced This Month";
    document.getElementById("todayTableTitle").textContent = isEmployee ? "My Production Today" : "Today's Production";
    document.getElementById("recentTableTitle").textContent = isEmployee ? "My Recent Production" : "Recent Production";
    document.getElementById("topTableTitle").textContent = isEmployee ? "My Most Produced Paint" : "Most Produced Paint";
    document.getElementById("recordsSubtitle").textContent = isEmployee ?
        "Production records you entered" : "All saved production records";
    if (isEmployee) {
        document.getElementById("cardTotal").classList.add("hidden");
        document.getElementById("producerFilterField").classList.add("hidden");
    } else {
        document.getElementById("cardTotal").classList.remove("hidden");
        document.getElementById("producerFilterField").classList.remove("hidden");
    }

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
        document.getElementById("downloadButtons").classList.remove("hidden");
    } else {
        document.getElementById("downloadButtons").classList.add("hidden");
    }

    if (canRestore()) {
        document.getElementById("restoreCard").classList.remove("hidden");
        document.getElementById("autoRestoreNote").classList.remove("hidden");
    } else {
        document.getElementById("restoreCard").classList.add("hidden");
        document.getElementById("autoRestoreNote").classList.add("hidden");
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

    watchRecords();
    watchProducts();
    watchBatchCounter();
    watchDailyBackups();
    runDailyBackup();       // catch up if no one was online at midnight
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

    // leaving the form while editing cancels the edit
    if (pageId != "add" && editingId != "") {
        clearForm();
        resetToAddMode();
        showMessage("", "");
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


// ===== NEW DAY CHECK =====
// if the page is left open past midnight, "today" moves to the new day:
// the Today card and table, the date picker limit, and employees' Edit buttons
let shownDay = todayText();

setInterval(function() {
    // a "Being edited by" lock ran out: redraw the table so the tag goes away
    if (currentUser != null && lockTagsShown) {
        displayRecords();
    }

    if (currentUser != null && todayText() != shownDay) {
        shownDay = todayText();
        document.getElementById("productionDate").max = shownDay;
        updateDashboard();
        displayRecords();
        runDailyBackup();   // 12 midnight: back up the day that just ended
    }
}, 60000);   // checks once a minute


// ===== BATCH NUMBER (made by the system, never reused) =====
// Firestore keeps a counter, Settings/batchCounter = { last: 25 },
// holding the highest batch number EVER given out. It only goes up,
// so a deleted batch's number is never given to a different product.
let batchCounter = 0;            // the counter's latest value
let stopWatchingCounter = null;

// keeps batchCounter up to date while the system is open
function watchBatchCounter() {
    stopCounterWatch();
    stopWatchingCounter = onSnapshot(doc(db, "Settings", "batchCounter"), function(counterDoc) {
        if (counterDoc.exists()) {
            batchCounter = Number(counterDoc.data().last) || 0;
        } else {
            batchCounter = 0;
        }
        showNextBatch();
    }, function(error) {
        console.error(error);
    });
}

function stopCounterWatch() {
    if (stopWatchingCounter != null) {
        stopWatchingCounter();
        stopWatchingCounter = null;
    }
}

// turns 25 into "BATCH-025"
function batchText(number) {
    return "BATCH-" + String(number).padStart(3, "0");
}

// highest BATCH-### among the records that still exist
// (covers records saved before the counter existed, or restored from a backup)
function highestSavedBatch() {
    let highest = 0;
    for (let i = 0; i < allRecords.length; i++) {
        let match = String(allRecords[i].batchNo).match(/^BATCH-(\d+)$/i);
        if (match != null && Number(match[1]) > highest) {
            highest = Number(match[1]);
        }
    }
    return highest;
}

// the number the next new batch will get (shown in the form)
function nextBatchNumber() {
    let last = Math.max(batchCounter, highestSavedBatch());
    return batchText(last + 1);
}

// shows the next batch number in the form (only when adding, not editing)
function showNextBatch() {
    if (editingId == "") {
        document.getElementById("batchNo").value = nextBatchNumber();
    }
}


// ===== PRODUCT LIST (dropdown) =====
// Products are kept in the Firestore "Products" collection so everyone
// picks the same names. A new name is added only after the operator
// confirms the spelling; then it appears in everyone's dropdown.
const NEW_PRODUCT = "__new__";
let savedProducts = [];          // names from the Products collection
let stopWatchingProducts = null;

function watchProducts() {
    stopProductsWatch();
    stopWatchingProducts = onSnapshot(collection(db, "Products"), function(snapshot) {
        savedProducts = [];
        snapshot.forEach(function(productDoc) {
            savedProducts.push(productDoc.data().name);
        });
        fillProductOptions();
    }, function(error) {
        console.error(error);
    });
}

function stopProductsWatch() {
    if (stopWatchingProducts != null) {
        stopWatchingProducts();
        stopWatchingProducts = null;
    }
}

// every product name: the saved list plus names already used in records
function allProductNames() {
    let names = [];
    function addName(name) {
        name = String(name || "").trim();
        if (name == "") return;
        for (let i = 0; i < names.length; i++) {
            if (names[i].toLowerCase() == name.toLowerCase()) return;   // no duplicates
        }
        names.push(name);
    }
    for (let i = 0; i < savedProducts.length; i++) addName(savedProducts[i]);
    for (let i = 0; i < allRecords.length; i++) addName(allRecords[i].productName);
    names.sort(function(a, b) {
        return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });
    return names;
}

// rebuilds the product dropdown, keeping the current choice
function fillProductOptions() {
    let select = document.getElementById("productName");
    let chosen = select.value;
    let names = allProductNames();

    // same list as before: leave it alone (rebuilding closes an open list)
    let listKey = names.join("\n");
    if (select.dataset.listKey == listKey) {
        return;
    }
    select.dataset.listKey = listKey;

    select.innerHTML = "";
    let first = document.createElement("option");
    first.value = "";
    first.textContent = "-- Select product --";
    select.appendChild(first);

    for (let i = 0; i < names.length; i++) {
        let option = document.createElement("option");
        option.value = names[i];
        option.textContent = names[i];
        select.appendChild(option);
    }

    let addOption = document.createElement("option");
    addOption.value = NEW_PRODUCT;
    addOption.textContent = "+ Add a new product...";
    select.appendChild(addOption);

    if (chosen == NEW_PRODUCT || names.includes(chosen)) {
        select.value = chosen;
    } else {
        select.value = "";
    }
}

// choosing "+ Add a new product..." opens the new product box
document.getElementById("productName").addEventListener("change", function() {
    if (this.value == NEW_PRODUCT) {
        document.getElementById("newProductBox").classList.remove("hidden");
        document.getElementById("newProductName").focus();
    } else {
        closeNewProductBox();
    }
});

document.getElementById("cancelProductButton").addEventListener("click", function() {
    closeNewProductBox();
    document.getElementById("productName").value = "";
});

document.getElementById("newProductName").addEventListener("keydown", function(e) {
    if (e.key == "Enter") addNewProduct();
});

document.getElementById("addProductButton").addEventListener("click", addNewProduct);

function closeNewProductBox() {
    document.getElementById("newProductBox").classList.add("hidden");
    document.getElementById("newProductName").value = "";
}

async function addNewProduct() {
    // clean up the typed name: trim and remove double spaces
    let name = document.getElementById("newProductName").value.trim().replace(/\s+/g, " ");

    if (name == "") {
        showMessage("Please type the new product name.", "error");
        return;
    }

    // already in the list (ignoring capital letters)? use that one instead
    let names = allProductNames();
    for (let i = 0; i < names.length; i++) {
        if (names[i].toLowerCase() == name.toLowerCase()) {
            closeNewProductBox();
            document.getElementById("productName").value = names[i];
            showMessage("\"" + names[i] + "\" is already in the list, so it was selected.", "success");
            return;
        }
    }

    // ask the operator to check the name before it is added
    let ok = confirm("Add \"" + name + "\" as a NEW product?\n\n" +
        "Please check the spelling. Once added, it will appear in the product list for everyone.");
    if (!ok) {
        showMessage("Product not added. Check the name and try again, or pick one from the list.", "error");
        return;
    }

    // the document ID is the name in small letters, so the same name can't be added twice
    let productId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";

    try {
        // if someone added the same product a moment ago, keep theirs
        let productRef = doc(db, "Products", productId);
        let result = await runTransaction(db, async function(transaction) {
            let existing = await transaction.get(productRef);
            if (existing.exists()) {
                return { added: false, name: existing.data().name, by: existing.data().addedBy };
            }
            transaction.set(productRef, {
                name: name,
                addedBy: currentUser.name,
                addedAt: new Date().toISOString()
            });
            return { added: true, name: name };
        });

        if (!savedProducts.includes(result.name)) {
            savedProducts.push(result.name);
        }
        fillProductOptions();
        closeNewProductBox();
        document.getElementById("productName").value = result.name;

        if (result.added) {
            showMessage("\"" + result.name + "\" was added to the product list.", "success");
        } else {
            showMessage("\"" + result.name + "\" was just added by " + (result.by || "someone else") + ", so it was selected.", "success");
        }
    }
    catch (error) {
        console.error(error);
        if (error.code == "permission-denied") {
            showMessage("Adding products was blocked by the Firestore rules. Add the Products rule in Firebase.", "error");
        } else {
            showMessage("Error adding the product. Please try again.", "error");
        }
    }
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
    document.getElementById("batchNo").value = nextBatchNumber();
    document.getElementById("productName").value = "";
    closeNewProductBox();
    document.getElementById("paintType").value = "";
    document.getElementById("color").value = "";
    document.getElementById("quantity").value = "";
    document.getElementById("productionDate").value = "";

    // the date picker cannot go past today
    document.getElementById("productionDate").max = todayText();

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
    releaseLock();
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
    // Batch Number is made by the system (worked out below, right before saving)
    let batchNo = "";
    let productName = document.getElementById("productName").value;
    if (productName == NEW_PRODUCT) {
        showMessage("Please finish adding the new product first (click Add Product), or pick one from the list.", "error");
        return;
    }
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

    if (productName.trim() == "" || paintType == "" ||
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

    // production date cannot be in the future
    if (productionDate > todayText()) {
        showMessage("Production date cannot be in the future", "error");
        return;
    }

    // ---- 2. stop double saving: lock the button while saving ----
    let saveButton = document.getElementById("Savebutton");
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    // get the latest records first, so the batch check also sees
    // records other users saved since this page was opened
    let wasEditing = (editingId != "");
    await loadRecords();

    // the record being edited was deleted by someone else just now:
    // stop here (the message is already shown) so it isn't saved as a new batch
    if (wasEditing && editingId == "") {
        unlockSaveButton();
        return;
    }

    // new record: the next number after the latest batch
    // (worked out after loading, in case someone else just saved one)
    // editing: the record keeps its own batch number
    if (editingId == "") {
        batchNo = nextBatchNumber();
    } else {
        batchNo = editingRecord.batchNo;
    }

    // safety check: batch number must not be used by another record
    for (let i = 0; i < allRecords.length; i++) {
        let sameBatch = String(allRecords[i].batchNo).toLowerCase() == batchNo.trim().toLowerCase();
        if (sameBatch && allRecords[i].id != editingId) {
            showMessage("Batch number " + batchNo.trim() + " already exists", "error");
            unlockSaveButton();
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

            // Get the batch number and save the record in ONE transaction:
            // 1. read the counter (highest number ever given out)
            // 2. next number = counter + 1, skipping any number still in use
            // 3. save the record under that number and move the counter up
            // If two people save at the same moment, Firestore runs one
            // transaction after the other, so both get different numbers.
            let counterRef = doc(db, "Settings", "batchCounter");
            let savedNumber = "";

            await runTransaction(db, async function(transaction) {
                let counterDoc = await transaction.get(counterRef);
                let last = highestSavedBatch();
                if (counterDoc.exists() && Number(counterDoc.data().last) > last) {
                    last = Number(counterDoc.data().last);
                }

                let number = last + 1;
                let batchRef = doc(db, "Productions", batchText(number));
                let existing = await transaction.get(batchRef);
                let tries = 0;
                while (existing.exists() && tries < 20) {
                    number++;
                    batchRef = doc(db, "Productions", batchText(number));
                    existing = await transaction.get(batchRef);
                    tries++;
                }
                if (existing.exists()) {
                    throw new Error("No free batch number found");
                }

                record.batchNo = batchText(number);
                transaction.set(batchRef, record);
                transaction.set(counterRef, { last: number });
                savedNumber = record.batchNo;
            });

            batchNo = savedNumber;
            showMessage("Production record " + batchNo + " saved successfully!", "success");
        } else {
            // update the record being edited
            if (!canEditRecord(editingRecord)) {
                showMessage("You can only edit records you entered today.", "error");
                unlockSaveButton();
                return;
            }
            record.lastEditedBy = currentUser.name;
            record.lastEditedAt = new Date().toISOString();
            mySaveStamp = record.lastEditedAt;

            // check the record again right before saving, so two people
            // editing the same batch can't overwrite each other's changes
            let recordRef = doc(db, "Productions", editingId);
            let result = await runTransaction(db, async function(transaction) {
                let latest = await transaction.get(recordRef);
                if (!latest.exists()) {
                    return { status: "deleted" };
                }
                // my editing time ran out and someone else opened it
                if (lockedByOther(latest.data())) {
                    return { status: "locked", data: latest.data() };
                }
                if (recordChanged(editingRecord, latest.data())) {
                    return { status: "changed", data: latest.data() };
                }
                // save the changes and free the batch in one go
                transaction.update(recordRef, Object.assign({}, record, noLock()));
                return { status: "saved" };
            });

            if (result.status == "deleted") {
                let deletedBatch = editingRecord.batchNo;
                clearForm();
                resetToAddMode();
                showMessage("Batch " + deletedBatch + " was deleted by someone else while you were editing. Your changes were not saved.", "error");
                unlockSaveButton();
                return;
            }

            if (result.status == "locked") {
                let lockedBatch = editingRecord.batchNo;
                lockedId = "";              // not mine anymore, don't touch it
                stopLockTimer();
                clearForm();
                resetToAddMode();
                showMessage("Your changes were NOT saved: " + lockedBatch + " is now being edited by " +
                    lockOwnerText(result.data) + " (your editing time ran out). Try again when they are done.", "error");
                unlockSaveButton();
                return;
            }

            if (result.status == "changed") {
                // load the other person's version into the form
                let latestRecord = result.data;
                latestRecord.id = editingId;
                let who = latestRecord.lastEditedBy || "Someone";
                editRecord(latestRecord);
                showMessage(who + " updated batch " + latestRecord.batchNo + " while you were editing, so your changes were NOT saved. " +
                    "The form now shows their version. Check it, make your changes again, then click Update.", "error");
                unlockSaveButton();
                return;
            }

            lockedId = "";                  // already freed by the save
            stopLockTimer();
            showMessage("Production record updated successfully!", "success");
            resetToAddMode();
        }

        clearForm();
        loadRecords();
    }
    catch (error) {
        console.error(error);
        if (error.code == "permission-denied") {
            showMessage("Saving was blocked by the Firestore rules. Add the Settings rule in Firebase.", "error");
        } else {
            showMessage("Error saving record. Check firebase setting and database", "error");
        }
    }

    unlockSaveButton();
}

// turns the Save button back on, with the right words for add or edit
function unlockSaveButton() {
    let saveButton = document.getElementById("Savebutton");
    saveButton.disabled = false;
    if (editingId == "") {
        saveButton.textContent = "Save Production Record";
    } else {
        saveButton.textContent = "Update Production Record";
    }
}


// true if the record was changed since "before" was loaded
function recordChanged(before, after) {
    let fields = ["productName", "paintType", "color", "finish", "quantity",
                  "productionDate", "lastEditedBy", "lastEditedAt"];
    for (let i = 0; i < fields.length; i++) {
        let a = String(before[fields[i]] ?? "");
        let b = String(after[fields[i]] ?? "");
        if (a != b) {
            return true;
        }
    }
    return false;
}

// while editing, watch the same record for changes made on other devices
let editWarningShown = false;
let mySaveStamp = "";      // time of this device's own save (not a change by someone else)

function checkEditingRecord() {
    if (editingId == "" || editingRecord == null) {
        return;
    }

    let latest = null;
    for (let i = 0; i < allRecords.length; i++) {
        if (allRecords[i].id == editingId) {
            latest = allRecords[i];
        }
    }

    // someone deleted it: stop editing
    if (latest == null) {
        let deletedBatch = editingRecord.batchNo;
        clearForm();
        resetToAddMode();
        showMessage("Batch " + deletedBatch + " was deleted by someone else, so editing was stopped.", "error");
        return;
    }

    // my editing time ran out and someone else opened it: stop now,
    // instead of letting me type changes that can't be saved
    if (lockedId == editingId && lockedByOther(latest)) {
        let takenBatch = editingRecord.batchNo;
        lockedId = "";              // not mine anymore, don't touch it
        stopLockTimer();
        clearForm();
        resetToAddMode();
        showMessage("Editing stopped: " + takenBatch + " is now being edited by " + lockOwnerText(latest) +
            " (your editing time ran out while the page was in the background).", "error");
        return;
    }

    // my own save coming back: not someone else's change
    if (latest.lastEditedAt && latest.lastEditedAt == mySaveStamp) {
        return;
    }

    // someone changed it: warn once (the form is not touched, so typing isn't lost)
    if (!editWarningShown && recordChanged(editingRecord, latest)) {
        editWarningShown = true;
        let who = latest.lastEditedBy || "Someone";
        showMessage("Heads up: " + who + " just changed batch " + latest.batchNo +
            ". If you click Update, you will be shown their version first so nothing gets overwritten.", "error");
    }
}

// ===== EDITING LOCK =====
// Only one person can edit a batch at a time. Opening a batch for editing
// marks it as "being edited by <name>". The mark is refreshed every 30 seconds
// while the form is open, and is treated as free after 2 minutes without a
// refresh (for example, if the browser was closed in the middle of editing).
const LOCK_MINUTES = 2;
const mySession = getTabId();     // this browser tab (kept after a page refresh)
let lockTagsShown = false;        // true while a "Being edited by" tag is on screen

function getTabId() {
    let id = "";
    try {
        id = sessionStorage.getItem("paintTrackTab") || "";
    } catch (error) {
        id = "";
    }
    if (id == "") {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        try {
            sessionStorage.setItem("paintTrackTab", id);
        } catch (error) {
            // private mode: a new id every time is still fine
        }
    }
    return id;
}
let lockedId = "";          // the batch this tab is holding
let lockTimer = null;

// is someone (anyone) editing this record right now?
function lockIsActive(r) {
    if (!r || !r.editingBy || !r.editingAt) {
        return false;
    }
    let age = Date.now() - new Date(r.editingAt).getTime();
    return age < LOCK_MINUTES * 60 * 1000;
}

// is someone else (another person, or me in another tab) editing it?
function lockedByOther(r) {
    return lockIsActive(r) && r.editingSession != mySession;
}

function lockOwnerText(r) {
    if (currentUser != null && r.editingByUid == currentUser.uid) {
        return r.editingBy + " (you, on another device or tab)";
    }
    return r.editingBy;
}

function lockedMessage(batchNo, r) {
    return batchNo + " is currently being edited by: " + lockOwnerText(r) +
        "\n\nPlease try again when they are done.";
}

// the lock fields, empty = nobody is editing
function noLock() {
    return { editingBy: "", editingByUid: "", editingSession: "", editingAt: "" };
}

// Edit button: lock the batch first, then open the form
async function startEdit(data) {
    if (!canEditRecord(data)) {
        return;
    }

    let recordRef = doc(db, "Productions", data.id);
    try {
        let result = await runTransaction(db, async function(transaction) {
            let latest = await transaction.get(recordRef);
            if (!latest.exists()) {
                return { status: "deleted" };
            }
            let r = latest.data();
            if (lockedByOther(r)) {
                return { status: "locked", data: r };
            }
            let myLock = {
                editingBy: currentUser.name,
                editingByUid: currentUser.uid,
                editingSession: mySession,
                editingAt: new Date().toISOString()
            };
            transaction.update(recordRef, myLock);
            Object.assign(r, myLock);
            r.id = data.id;
            return { status: "ok", data: r };
        });

        if (result.status == "deleted") {
            alert(data.batchNo + " was already deleted.");
            return;
        }
        if (result.status == "locked") {
            alert(lockedMessage(data.batchNo, result.data));
            return;
        }

        lockedId = data.id;
        startLockTimer();
        editRecord(result.data);       // fill the form with the latest copy
    }
    catch (error) {
        console.error(error);
        alert("Could not open " + data.batchNo + " for editing. Please try again.");
    }
}

// keep the lock fresh while the form is open
function startLockTimer() {
    stopLockTimer();
    lockTimer = setInterval(refreshLock, 30 * 1000);
}

function stopLockTimer() {
    if (lockTimer != null) {
        clearInterval(lockTimer);
        lockTimer = null;
    }
}

async function refreshLock() {
    if (lockedId == "") {
        return;
    }
    let recordRef = doc(db, "Productions", lockedId);
    try {
        await runTransaction(db, async function(transaction) {
            let latest = await transaction.get(recordRef);
            // only refresh it if it is still mine
            if (latest.exists() && latest.data().editingSession == mySession) {
                transaction.update(recordRef, { editingAt: new Date().toISOString() });
            }
        });
    }
    catch (error) {
        console.log("Lock not refreshed:", error);
    }
}

// free the batch so others can edit it
async function releaseLock() {
    if (lockedId == "") {
        return;
    }
    let id = lockedId;
    lockedId = "";
    stopLockTimer();

    let recordRef = doc(db, "Productions", id);
    try {
        await runTransaction(db, async function(transaction) {
            let latest = await transaction.get(recordRef);
            if (latest.exists() && latest.data().editingSession == mySession) {
                transaction.update(recordRef, noLock());
            }
        });
    }
    catch (error) {
        console.log("Lock not released:", error);
    }
}

// coming back to the tab (phones pause timers in the background):
// refresh the lock right away
document.addEventListener("visibilitychange", function() {
    if (document.visibilityState == "visible") {
        refreshLock();
    }
});

// closing or refreshing the page while editing frees the batch
// (if this doesn't finish in time, the lock simply runs out after 2 minutes)
window.addEventListener("beforeunload", function() {
    releaseLock();
});

// ===== EDIT RECORD (loads the record into the form) =====
function editRecord(data) {
    if (!canEditRecord(data)) {
        return;
    }
    editingId = data.id;
    editingRecord = data;
    editWarningShown = false;

    document.getElementById("batchNo").value = data.batchNo;
    fillProductOptions();
    closeNewProductBox();
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

// reads the records once (used right before saving, to be sure they are current)
async function loadRecords() {
    try {
        let snapshot = await getDocs(collection(db, "Productions"));
        useRecords(snapshot);
    }
    catch (error) {
        console.error(error);
        document.getElementById("recordsList").innerHTML =
            "<tr><td colspan='9' class='empty'>Error loading records. Check firebase setting and database</td></tr>";
    }
}

// keeps the records live: whenever anyone adds, edits or deletes a record,
// Firestore sends the new list and every table and card updates by itself
let stopWatchingRecords = null;

function watchRecords() {
    stopRecordsWatch();
    stopWatchingRecords = onSnapshot(collection(db, "Productions"), useRecords, function(error) {
        console.error(error);
        document.getElementById("recordsList").innerHTML =
            "<tr><td colspan='9' class='empty'>Error loading records. Check firebase setting and database</td></tr>";
    });
}

function stopRecordsWatch() {
    if (stopWatchingRecords != null) {
        stopWatchingRecords();
        stopWatchingRecords = null;
    }
}

// puts a list of records from Firestore on the screen
function useRecords(snapshot) {
    allRecords = [];

    snapshot.forEach(function(record) {
        let data = record.data();
        data.id = record.id;
        // make sure the date is a clean "YYYY-MM-DD" text
        data.productionDate = String(data.productionDate || "").trim();
        allRecords.push(data);
    });

    // newest production date first; same date -> newest entered first
    allRecords.sort(function(a, b) {
        if (a.productionDate < b.productionDate) return 1;
        if (a.productionDate > b.productionDate) return -1;
        let aTime = a.createdAt || "";
        let bTime = b.createdAt || "";
        if (aTime < bTime) return 1;
        if (aTime > bTime) return -1;
        return 0;
    });

    fillFilterOptions();
    fillProductOptions();
    updateDashboard();
    displayRecords();
    document.getElementById("backupCount").textContent = allRecords.length;
    showNextBatch();
    checkEditingRecord();
}


// ===== DASHBOARD (today, this week, this month) =====
// ===== MOST PRODUCED PAINT =====
// adds up the liters of each product and ranks them (highest first)
function showTopProducts(records, monday, sunday, today) {
    let period = document.getElementById("topPeriod").value;
    let totals = {};        // key = product name in small letters
    let grandTotal = 0;

    for (let i = 0; i < records.length; i++) {
        let r = records[i];
        let name = String(r.productName || "").trim();
        if (name == "") {
            continue;
        }

        // keep only the records inside the chosen period
        if (period != "all") {
            if (!r.productionDate) {
                continue;
            }
            let parts = r.productionDate.split("-");
            let recordDate = new Date(parts[0], parts[1] - 1, parts[2]);
            if (period == "week" && (recordDate < monday || recordDate > sunday)) {
                continue;
            }
            if (period == "month" && (recordDate.getMonth() != today.getMonth() ||
                recordDate.getFullYear() != today.getFullYear())) {
                continue;
            }
        }

        let key = name.toLowerCase();
        if (!totals[key]) {
            totals[key] = { name: name, batches: 0, liters: 0 };
        }
        let qty = Number(r.quantity) || 0;
        totals[key].batches++;
        totals[key].liters += qty;
        grandTotal += qty;
    }

    // turn into a list and sort: most liters first, then most batches
    let list = Object.values(totals);
    list.sort(function(a, b) {
        if (b.liters != a.liters) {
            return b.liters - a.liters;
        }
        if (b.batches != a.batches) {
            return b.batches - a.batches;
        }
        return a.name.localeCompare(b.name);
    });

    let periodText = "of all time";
    if (period == "month") {
        periodText = "this month";
    } else if (period == "week") {
        periodText = "this week";
    }

    let table = document.getElementById("topList");
    table.innerHTML = "";

    if (list.length == 0) {
        document.getElementById("topName").textContent = "-";
        document.getElementById("topDetail").textContent = "No production " + periodText + " yet";
        table.innerHTML = "<tr><td colspan='5' class='empty'>No production " + periodText + " yet.</td></tr>";
        return;
    }

    // highlight box: number 1
    let first = list[0];
    document.getElementById("topName").textContent = first.name;
    document.getElementById("topDetail").textContent =
        first.liters.toLocaleString() + " L in " + first.batches + " batch(es) " + periodText;

    // table: top 5
    let count = Math.min(list.length, 5);
    for (let i = 0; i < count; i++) {
        let p = list[i];
        let share = grandTotal > 0 ? Math.round((p.liters / grandTotal) * 100) : 0;
        let rankClass = (i == 0) ? "rank first" : "rank";
        let row = document.createElement("tr");
        row.innerHTML =
            "<td><span class='" + rankClass + "'>" + (i + 1) + "</span></td>" +
            "<td>" + safe(p.name) + "</td>" +
            "<td>" + p.batches + "</td>" +
            "<td>" + p.liters.toLocaleString() + " L</td>" +
            "<td class='share-col'><div class='share-bar'>" +
                "<span class='share-track'><span class='share-fill' style='width:" + share + "%'></span></span>" +
                "<span class='share-text'>" + share + "%</span>" +
            "</div></td>";
        table.appendChild(row);
    }
}

// changing the period redraws the dashboard
document.getElementById("topPeriod").addEventListener("change", updateDashboard);

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

    // Employees: only their own batches; admins: everyone's
    let records = visibleRecords();

    for (let i = 0; i < records.length; i++) {
        let r = records[i];
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
    document.getElementById("totalRecords").textContent = records.length;

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

    // ----- Most Produced Paint -----
    showTopProducts(records, monday, sunday, today);

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
                "<td>" + safe(r.batchNo) + "</td>" +
                "<td>" + safe(r.productName) + "</td>" +
                "<td>" + safe(r.paintType) + "</td>" +
                "<td>" + safe(r.color) + "</td>" +
                "<td>" + safe(r.finish) + "</td>" +
                "<td>" + safe(r.quantity) + "</td>" +
                "<td>" + safe(r.producedBy) + "</td>";
            todayTable.appendChild(row);
        }
    }

    // ----- Recent Production table (latest 5) -----
    // records are already sorted newest date first
    let recentTable = document.getElementById("recentList");
    recentTable.innerHTML = "";

    if (records.length == 0) {
        recentTable.innerHTML = "<tr><td colspan='8' class='empty'>No production records yet.</td></tr>";
    } else {
        let limit = Math.min(5, records.length);
        for (let i = 0; i < limit; i++) {
            let r = records[i];
            let row = document.createElement("tr");
            row.innerHTML =
                "<td>" + safe(r.batchNo) + "</td>" +
                "<td>" + safe(r.productName) + "</td>" +
                "<td>" + safe(r.paintType) + "</td>" +
                "<td>" + safe(r.color) + "</td>" +
                "<td>" + safe(r.finish) + "</td>" +
                "<td>" + safe(r.quantity) + "</td>" +
                "<td>" + safe(r.productionDate) + "</td>" +
                "<td>" + safe(r.producedBy) + "</td>";
            recentTable.appendChild(row);
        }
    }
}


// ===== DASHBOARD CARDS -> VIEW RECORDS =====
// clicking a card opens View Records with the same dates the card counts

// turns a date into "YYYY-MM-DD"
function dateText(day) {
    return day.getFullYear() + "-" +
        String(day.getMonth() + 1).padStart(2, "0") + "-" +
        String(day.getDate()).padStart(2, "0");
}

function openRecords(start, end) {
    document.getElementById("startDate").value = start;
    document.getElementById("endDate").value = end;
    clearExtraFilters();
    displayRecords();
    showPage("records", "recordsBtn");
}

function openToday() {
    openRecords(todayText(), todayText());
}

function openThisWeek() {
    // Monday to Sunday, the same week the dashboard card counts
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let day = today.getDay();                      // 0 = Sunday, 1 = Monday ...
    let daysFromMonday = (day == 0) ? 6 : day - 1;
    let monday = new Date(today);
    monday.setDate(today.getDate() - daysFromMonday);
    let sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    openRecords(dateText(monday), dateText(sunday));
}

function openThisMonth() {
    let today = new Date();
    let firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    let lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    openRecords(dateText(firstDay), dateText(lastDay));
}

function openAllRecords() {
    openRecords("", "");
}

// click, or press Enter on a card
function cardShortcut(cardId, action) {
    let card = document.getElementById(cardId);
    card.addEventListener("click", action);
    card.addEventListener("keydown", function(e) {
        if (e.key == "Enter") action();
    });
}

cardShortcut("cardToday", openToday);
cardShortcut("cardWeek", openThisWeek);
cardShortcut("cardMonth", openThisMonth);
cardShortcut("cardTotal", openAllRecords);


// ===== VIEW RECORDS (with start to end date filter) =====
// the table updates as soon as a date is picked or changed
document.getElementById("startDate").addEventListener("change", displayRecords);
document.getElementById("endDate").addEventListener("change", displayRecords);
document.getElementById("startDate").addEventListener("input", displayRecords);
document.getElementById("endDate").addEventListener("input", displayRecords);

// search, Produced By, Product and Sort update the table right away
document.getElementById("batchSearch").addEventListener("input", displayRecords);
document.getElementById("producerFilter").addEventListener("change", displayRecords);
document.getElementById("productFilter").addEventListener("change", displayRecords);
document.getElementById("sortBy").addEventListener("change", displayRecords);

// Show All clears every filter
document.getElementById("showAllButton").addEventListener("click", function() {
    document.getElementById("startDate").value = "";
    document.getElementById("endDate").value = "";
    clearExtraFilters();
    displayRecords();
});

function clearExtraFilters() {
    document.getElementById("batchSearch").value = "";
    document.getElementById("producerFilter").value = "";
    document.getElementById("productFilter").value = "";
}

// fills the Produced By and Product dropdowns from the records,
// keeping what was chosen if it is still there
function fillFilterOptions() {
    let records = visibleRecords();
    let producers = [];
    let products = [];

    for (let i = 0; i < records.length; i++) {
        let producer = String(records[i].producedBy || "");
        let product = String(records[i].productName || "");
        if (producer != "" && !producers.includes(producer)) producers.push(producer);
        if (product != "" && !products.includes(product)) products.push(product);
    }
    producers.sort();
    products.sort();

    fillSelect("producerFilter", "All employees", producers);
    fillSelect("productFilter", "All products", products);
}

function fillSelect(selectId, allText, values) {
    let select = document.getElementById(selectId);
    let chosen = select.value;

    // same list as before: leave it alone (rebuilding closes an open list)
    let listKey = allText + "\n" + values.join("\n");
    if (select.dataset.listKey == listKey) {
        return;
    }
    select.dataset.listKey = listKey;

    select.innerHTML = "";
    let first = document.createElement("option");
    first.value = "";
    first.textContent = allText;
    select.appendChild(first);

    for (let i = 0; i < values.length; i++) {
        let option = document.createElement("option");
        option.value = values[i];
        option.textContent = values[i];
        select.appendChild(option);
    }

    select.value = values.includes(chosen) ? chosen : "";
}

// words describing the search and dropdown filters, for the summary line and PDF
function getFilterText() {
    let parts = [];
    let search = document.getElementById("batchSearch").value.trim();
    let producer = document.getElementById("producerFilter").value;
    let product = document.getElementById("productFilter").value;

    if (search != "") parts.push("Batch contains \"" + search + "\"");
    if (producer != "") parts.push("Produced by " + producer);
    if (product != "") parts.push("Product: " + product);
    return parts.join("  |  ");
}

// returns the text that describes the selected date range
// sorts the shown records by the Sort By choice
function sortShownRecords() {
    let sortBy = document.getElementById("sortBy").value;

    // turns "BATCH-025" into 25 for number order
    function batchNumber(r) {
        let match = String(r.batchNo).match(/(\d+)$/);
        return match ? Number(match[1]) : 0;
    }
    function text(value) {
        return String(value || "").toLowerCase();
    }
    // newest date first, then newest entry first (the normal order)
    function newest(a, b) {
        if (a.productionDate != b.productionDate) return a.productionDate < b.productionDate ? 1 : -1;
        let aTime = a.createdAt || "", bTime = b.createdAt || "";
        if (aTime != bTime) return aTime < bTime ? 1 : -1;
        return 0;
    }

    shownRecords.sort(function(a, b) {
        if (sortBy == "oldest") {
            return -newest(a, b);
        }
        if (sortBy == "product") {
            if (text(a.productName) != text(b.productName)) return text(a.productName) < text(b.productName) ? -1 : 1;
            return newest(a, b);
        }
        if (sortBy == "producer") {
            if (text(a.producedBy) != text(b.producedBy)) return text(a.producedBy) < text(b.producedBy) ? -1 : 1;
            return newest(a, b);
        }
        if (sortBy == "qtyHigh") {
            let diff = (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
            return diff != 0 ? diff : newest(a, b);
        }
        if (sortBy == "batch") {
            return batchNumber(b) - batchNumber(a);
        }
        return newest(a, b);
    });
}

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

    let search = document.getElementById("batchSearch").value.trim().toLowerCase();
    let producer = document.getElementById("producerFilter").value;
    let product = document.getElementById("productFilter").value;
    let records = visibleRecords();

    // keep only the records that match every filter
    // ("YYYY-MM-DD" text can be compared directly)
    for (let i = 0; i < records.length; i++) {
        let r = records[i];
        let date = r.productionDate;

        if (startDate != "" && date < startDate) {
            continue;
        }
        if (endDate != "" && date > endDate) {
            continue;
        }
        if (search != "" && !String(r.batchNo).toLowerCase().includes(search)) {
            continue;
        }
        if (producer != "" && r.producedBy != producer) {
            continue;
        }
        if (product != "" && r.productName != product) {
            continue;
        }
        shownRecords.push(r);
    }

    sortShownRecords();

    // total liters of the shown records
    let liters = 0;
    for (let i = 0; i < shownRecords.length; i++) {
        liters += Number(shownRecords[i].quantity) || 0;
    }

    // info text above the table
    let filterText = getFilterText();
    document.getElementById("filterInfo").textContent =
        "Showing: " + getRangeText() + (filterText != "" ? "  |  " + filterText : "") +
        "  |  " + shownRecords.length + " record(s)  |  " +
        liters.toLocaleString() + " L produced";

    lockTagsShown = false;
    if (shownRecords.length == 0) {
        table.innerHTML = "<tr><td colspan='9' class='empty'>No production records found.</td></tr>";
        return;
    }

    for (let i = 0; i < shownRecords.length; i++) {
        let data = shownRecords[i];

        let row = document.createElement("tr");
        row.innerHTML =
            "<td>" + safe(data.batchNo) + "</td>" +
            "<td>" + safe(data.productName) + "</td>" +
            "<td>" + safe(data.paintType) + "</td>" +
            "<td>" + safe(data.color) + "</td>" +
            "<td>" + safe(data.finish) + "</td>" +
            "<td>" + safe(data.quantity) + "</td>" +
            "<td>" + safe(data.productionDate) + "</td>" +
            "<td>" + safe(data.producedBy) + "</td>";

        let actionCell = document.createElement("td");

        // edit button (admins: any record, employees: own records entered today)
        if (canEditRecord(data)) {
            let editButton = document.createElement("button");
            editButton.textContent = "Edit";
            editButton.className = "btn-edit";
            editButton.addEventListener("click", function() {
                startEdit(data);
            });
            actionCell.appendChild(editButton);
        }

        // someone else has this batch open in the edit form
        if (lockedByOther(data)) {
            lockTagsShown = true;
            let tag = document.createElement("span");
            tag.className = "editing-tag";
            tag.textContent = "Being edited by " + data.editingBy;
            actionCell.insertBefore(tag, actionCell.firstChild);
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
    // can't delete a batch someone is editing right now
    for (let i = 0; i < allRecords.length; i++) {
        if (allRecords[i].id == id && lockedByOther(allRecords[i])) {
            alert("Cannot delete. " + lockedMessage(allRecords[i].batchNo, allRecords[i]));
            return;
        }
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

    // search and dropdown filters, if any are used
    let tableTop = 65;
    let pdfFilters = getFilterText();
    if (pdfFilters != "") {
        pdf.text("Filters: " + pdfFilters.split("  |  ").join(", "), 14, 65);
        tableTop = 71;
    }

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
        startY: tableTop,
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


// ===== EXCEL =====
document.getElementById("excelButton").addEventListener("click", downloadExcel);

function downloadExcel() {
    if (!canDownload()) {
        alert("Your account is not allowed to download files.");
        return;
    }

    if (shownRecords.length == 0) {
        alert("No records to download.");
        return;
    }

    if (!window.XLSX) {
        alert("The Excel tool did not load. Check your internet and refresh the page.");
        return;
    }

    let startDate = document.getElementById("startDate").value;
    let endDate = document.getElementById("endDate").value;

    // total liters of the shown records
    let liters = 0;
    for (let i = 0; i < shownRecords.length; i++) {
        liters += Number(shownRecords[i].quantity) || 0;
    }

    // rows of the sheet (each inner list is one row)
    let rows = [];
    rows.push(["7CM PaintTrack - Paint Production Records"]);
    rows.push(["Production Date:", getRangeText()]);
    let filters = getFilterText();
    if (filters != "") {
        rows.push(["Filters:", filters.split("  |  ").join(", ")]);
    }
    rows.push(["Total Records:", shownRecords.length]);
    rows.push(["Total Liters:", liters]);
    rows.push(["Generated:", new Date().toLocaleString()]);
    rows.push([]);
    rows.push(["Batch No.", "Product Name", "Type", "Color", "Finish", "Qty (L)", "Date", "Produced By"]);

    for (let i = 0; i < shownRecords.length; i++) {
        let r = shownRecords[i];
        rows.push([
            r.batchNo,
            r.productName,
            r.paintType,
            r.color,
            r.finish,
            Number(r.quantity) || 0,     // kept as a number so Excel can add it up
            r.productionDate,
            r.producedBy
        ]);
    }
    rows.push(["", "", "", "", "TOTAL", liters, "", ""]);

    let sheet = XLSX.utils.aoa_to_sheet(rows);

    // column widths
    sheet["!cols"] = [
        { wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 14 },
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 20 }
    ];

    let book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Production Records");

    // file name includes the date range if one is selected
    let fileName = "production-records";
    if (startDate != "") {
        fileName += "_from-" + startDate;
    }
    if (endDate != "") {
        fileName += "_to-" + endDate;
    }
    XLSX.writeFile(book, fileName + ".xlsx");
}


// ===== BACKUP =====
document.getElementById("backupButton").addEventListener("click", downloadBackup);

// one record as it is kept in a backup (without the Firestore id)
function backupCopy(r) {
    return {
        batchNo: r.batchNo,
        productName: r.productName,
        paintType: r.paintType,
        color: r.color,
        finish: r.finish,
        quantity: r.quantity,
        productionDate: r.productionDate,
        producedBy: r.producedBy,
        recordedBy: r.recordedBy || "",
        recordedByUid: r.recordedByUid || "",
        createdAt: r.createdAt || "",
        lastEditedBy: r.lastEditedBy || ""
    };
}

// turns a backup into a .json file and downloads it
function saveJsonFile(backup, fileName) {
    let text = JSON.stringify(backup, null, 2);
    let file = new Blob([text], { type: "application/json" });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
}

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

    let records = [];
    for (let i = 0; i < allRecords.length; i++) {
        records.push(backupCopy(allRecords[i]));
    }

    let backup = {
        system: "PaintTrack",
        backupDate: new Date().toLocaleString(),
        totalRecords: records.length,
        records: records
    };

    saveJsonFile(backup, "painttrack-backup-" + todayText() + ".json");

    message.textContent = "Backup downloaded (" + records.length + " records).";
    message.className = "message success";
}


// ===== RESTORE (from a file) =====
document.getElementById("restoreButton").addEventListener("click", restoreBackup);

function setRestoreMessage(text, type) {
    let message = document.getElementById("restoreMessage");
    message.textContent = text;
    message.className = "message " + type;
}

function restoreBackup() {
    if (!canRestore()) {
        setRestoreMessage("Only the Mother Admin can restore backups.", "error");
        return;
    }
    let fileInput = document.getElementById("restoreFile");

    if (fileInput.files.length == 0) {
        setRestoreMessage("Please choose a backup file first.", "error");
        return;
    }

    // read the file
    let reader = new FileReader();
    reader.onload = async function() {
        let backup;

        // check if the file is a valid PaintTrack backup
        try {
            backup = JSON.parse(reader.result);
        }
        catch (error) {
            setRestoreMessage("This file is not a valid backup file.", "error");
            return;
        }

        if (backup.system != "PaintTrack" || !Array.isArray(backup.records)) {
            setRestoreMessage("This file is not a PaintTrack backup.", "error");
            return;
        }

        let done = await restoreRecords(backup.records);
        if (done) {
            fileInput.value = "";
        }
    };

    reader.readAsText(fileInput.files[0]);
}

// puts a list of backup records back into Firestore,
// using the Restore Option picked on the Restore card.
// Used by the file restore and by the automatic daily backups.
async function restoreRecords(backupRecords) {
    if (!canRestore()) {
        setRestoreMessage("Only the Mother Admin can restore backups.", "error");
        return false;
    }

    let mode = document.querySelector('input[name="restoreMode"]:checked').value;

    if (mode == "replace") {
        let ok = confirm("This will DELETE all " + allRecords.length +
            " current records and replace them with " + backupRecords.length +
            " records from the backup. A safety backup of the current records " +
            "will be downloaded first. Continue?");
        if (!ok) {
            return false;
        }

        // safety net: save the current records before deleting them
        if (allRecords.length > 0) {
            downloadBackup();
        }
    } else {
        let ok = confirm("Add the records from this backup that are missing now (" +
            backupRecords.length + " records in the backup)?");
        if (!ok) {
            return false;
        }
    }

    let restoreButton = document.getElementById("restoreButton");
    restoreButton.disabled = true;
    restoreButton.textContent = "Restoring...";
    setRestoreMessage("Restoring records, please wait...", "");

    let done = false;

    try {
        // batch numbers that already exist
        let usedBatches = [];

        if (mode == "replace") {
            // delete all current records first.
            // Work on a copy of the list: every delete updates allRecords
            // live, and looping over the shrinking list would skip records.
            let toDelete = allRecords.slice();
            for (let i = 0; i < toDelete.length; i++) {
                await deleteDoc(doc(db, "Productions", toDelete[i].id));
            }
        } else {
            for (let i = 0; i < allRecords.length; i++) {
                usedBatches.push(String(allRecords[i].batchNo).toLowerCase());
            }
        }

        let added = 0, skipped = 0, invalid = 0;

        for (let i = 0; i < backupRecords.length; i++) {
            let r = backupRecords[i];

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

            let restored = {
                batchNo: String(r.batchNo).trim(),
                productName: String(r.productName).trim(),
                paintType: r.paintType,
                color: String(r.color).trim(),
                finish: r.finish,
                quantity: Number(r.quantity),
                productionDate: String(r.productionDate).trim(),
                producedBy: String(r.producedBy).trim(),
                // keep who entered it and when (older backups may not have these)
                recordedBy: r.recordedBy ? String(r.recordedBy) : "Restored from backup",
                recordedByUid: r.recordedByUid ? String(r.recordedByUid) : "",
                createdAt: r.createdAt ? String(r.createdAt) : new Date().toISOString(),
                restoredBy: currentUser.name
            };
            if (r.lastEditedBy) {
                restored.lastEditedBy = String(r.lastEditedBy);
            }

            await addDoc(collection(db, "Productions"), restored);
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
        setRestoreMessage(result + ".", "success");
        done = true;
    }
    catch (error) {
        console.error(error);
        setRestoreMessage("Error restoring records. Check firebase setting and database", "error");
    }

    restoreButton.disabled = false;
    restoreButton.textContent = "Restore Backup";
    loadRecords();
    return done;
}


// ===== AUTOMATIC DAILY BACKUP =====
// Every night at 12 midnight, PaintTrack saves a copy of all records
// online, in the Firestore "Backups" collection, one document per day.
// - It runs in any open PaintTrack page (any account type).
// - If no page was open at midnight, the first person who opens
//   PaintTrack the next day makes that backup.
// - Only ONE backup per day is saved, even if many pages are open
//   (a transaction checks that the day's backup does not exist yet).
// - The last 30 daily backups are kept; older ones are removed.
const KEEP_BACKUPS = 30;

// yesterday's date as "YYYY-MM-DD" (the day that just ended at midnight)
function yesterdayText() {
    let day = new Date();
    day.setDate(day.getDate() - 1);
    return day.getFullYear() + "-" +
        String(day.getMonth() + 1).padStart(2, "0") + "-" +
        String(day.getDate()).padStart(2, "0");
}

async function runDailyBackup() {
    if (currentUser == null) {
        return;
    }

    let backupDay = yesterdayText();
    let backupRef = doc(db, "Backups", backupDay);

    try {
        // quick check first: already backed up today? then nothing to do
        let existing = await getDoc(backupRef);
        if (existing.exists()) {
            return;
        }

        // fresh copy of every record
        let snapshot = await getDocs(collection(db, "Productions"));
        let records = [];
        snapshot.forEach(function(record) {
            records.push(backupCopy(record.data()));
        });

        if (records.length == 0) {
            return;     // nothing to back up yet
        }

        // a Firestore document can hold about 1 MB
        if (JSON.stringify(records).length > 900000) {
            console.log("Automatic backup skipped: too many records for one backup. Use Download Backup.");
            return;
        }

        let made = await runTransaction(db, async function(transaction) {
            let again = await transaction.get(backupRef);
            if (again.exists()) {
                return false;   // another open page made it a moment ago
            }
            transaction.set(backupRef, {
                system: "PaintTrack",
                backupOf: backupDay,
                madeAt: new Date().toISOString(),
                madeBy: currentUser.name,
                totalRecords: records.length,
                records: records
            });
            return true;
        });

        if (made) {
            await removeOldBackups();
        }
    }
    catch (error) {
        console.error("Automatic backup failed:", error);
    }
}

// keeps only the newest 30 daily backups
async function removeOldBackups() {
    let snapshot = await getDocs(collection(db, "Backups"));
    let days = [];
    snapshot.forEach(function(backupDoc) {
        days.push(backupDoc.id);
    });

    days.sort();        // "YYYY-MM-DD" sorts oldest first
    days.reverse();     // newest first

    for (let i = KEEP_BACKUPS; i < days.length; i++) {
        await deleteDoc(doc(db, "Backups", days[i]));
    }
}


// ===== AUTOMATIC BACKUP LIST (Backup & Restore page) =====
let dailyBackups = [];
let stopWatchingBackups = null;

// keeps the list live for Mother Admins and Admins
function watchDailyBackups() {
    stopBackupsWatch();
    if (!canBackup()) {
        return;
    }
    stopWatchingBackups = onSnapshot(collection(db, "Backups"), function(snapshot) {
        dailyBackups = [];
        snapshot.forEach(function(backupDoc) {
            let data = backupDoc.data();
            data.id = backupDoc.id;
            dailyBackups.push(data);
        });
        // newest first
        dailyBackups.sort(function(a, b) {
            if (a.id < b.id) return 1;
            if (a.id > b.id) return -1;
            return 0;
        });
        showDailyBackups();
    }, function(error) {
        console.error(error);
        document.getElementById("autoBackupList").innerHTML =
            "<tr><td colspan='5' class='empty'>Cannot load the daily backups. Check the Firestore rules.</td></tr>";
    });
}

function stopBackupsWatch() {
    if (stopWatchingBackups != null) {
        stopWatchingBackups();
        stopWatchingBackups = null;
    }
}

function showDailyBackups() {
    let table = document.getElementById("autoBackupList");
    table.innerHTML = "";

    if (dailyBackups.length == 0) {
        table.innerHTML = "<tr><td colspan='5' class='empty'>No daily backups yet. The first one is made at 12 midnight.</td></tr>";
        return;
    }

    for (let i = 0; i < dailyBackups.length; i++) {
        let b = dailyBackups[i];
        let row = document.createElement("tr");
        row.innerHTML =
            "<td>" + safe(b.backupOf || b.id) + "</td>" +
            "<td>" + safe(b.totalRecords) + "</td>" +
            "<td>" + safe(new Date(b.madeAt).toLocaleString()) + "</td>" +
            "<td>" + safe(b.madeBy) + "</td>";

        let actionCell = document.createElement("td");

        let downloadButton = document.createElement("button");
        downloadButton.textContent = "Download";
        downloadButton.className = "btn-edit";
        downloadButton.addEventListener("click", function() {
            saveJsonFile({
                system: "PaintTrack",
                backupDate: new Date(b.madeAt).toLocaleString(),
                totalRecords: b.totalRecords,
                records: b.records
            }, "painttrack-backup-" + (b.backupOf || b.id) + ".json");
        });
        actionCell.appendChild(downloadButton);

        if (canRestore()) {
            let restoreButton = document.createElement("button");
            restoreButton.textContent = "Restore";
            restoreButton.className = "btn-secondary btn-small";
            restoreButton.addEventListener("click", function() {
                restoreRecords(b.records);
            });
            actionCell.appendChild(restoreButton);
        }

        row.appendChild(actionCell);
        table.appendChild(row);
    }
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
                "<td>" + safe(account.name) + you + "</td>" +
                "<td>" + safe(account.email) + "</td>" +
                "<td><span class='role-badge " + account.role + "'>" + roleName(account.role) + "</span></td>" +
                "<td><span class='" + statusClass + "'>" + statusText + "</span></td>";

            let actionCell = document.createElement("td");

            // Mother Admin can rename every account, including her own
            if (currentUser.role == "mother_admin") {
                let nameButton = document.createElement("button");
                nameButton.textContent = "Edit Name";
                nameButton.className = "btn-secondary btn-small";
                nameButton.addEventListener("click", function() {
                    renameAccount(account, accounts);
                });
                actionCell.appendChild(nameButton);
            }

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
            } else if (actionCell.children.length == 0) {
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

// Mother Admin only: change an account's name.
// "Produced By" on that person's production records is updated too,
// so their records still show (and still count) under their new name.
async function renameAccount(account, accounts) {
    if (currentUser.role != "mother_admin") {
        return;
    }

    let typed = prompt("New name for " + account.name + ":", account.name);
    if (typed == null) {
        return;     // Cancel
    }

    // clean up the typed name: trim and remove double spaces
    let newName = typed.trim().replace(/\s+/g, " ");

    if (newName == "") {
        setAccountMessage("The name cannot be empty.", "error");
        return;
    }
    if (newName.length > 50) {
        setAccountMessage("The name can have at most 50 characters.", "error");
        return;
    }
    if (newName == account.name) {
        return;     // nothing changed
    }

    // two accounts with the same name would mix up their records
    for (let i = 0; i < accounts.length; i++) {
        if (accounts[i].id != account.id &&
            String(accounts[i].name).toLowerCase() == newName.toLowerCase()) {
            setAccountMessage("Another account is already named \"" + newName + "\". Please use a different name.", "error");
            return;
        }
    }

    // this person's production records (by account id, or by name for older/restored ones)
    let theirRecords = [];
    for (let i = 0; i < allRecords.length; i++) {
        let r = allRecords[i];
        if (r.recordedByUid == account.id || (!r.recordedByUid && r.producedBy == account.name)) {
            theirRecords.push(r);
        }
    }

    let ok = confirm("Change the name \"" + account.name + "\" to \"" + newName + "\"?\n\n" +
        "Produced By will also be updated on their " + theirRecords.length + " production record(s).");
    if (!ok) {
        return;
    }

    try {
        await updateDoc(doc(db, "Users", account.id), { name: newName });

        for (let i = 0; i < theirRecords.length; i++) {
            let r = theirRecords[i];
            let changes = { producedBy: newName };
            if (r.recordedBy == account.name) {
                changes.recordedBy = newName;
            }
            if (r.lastEditedBy == account.name) {
                changes.lastEditedBy = newName;
            }
            await updateDoc(doc(db, "Productions", r.id), changes);
        }

        // renamed myself: update the sidebar and forms right away
        if (account.id == currentUser.uid) {
            currentUser.name = newName;
            showMyName();
        }

        setAccountMessage("\"" + account.name + "\" is now \"" + newName + "\". " +
            theirRecords.length + " production record(s) updated.", "success");
        loadAccounts();
    }
    catch (error) {
        console.error(error);
        setAccountMessage("Error changing the name. Please try again.", "error");
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