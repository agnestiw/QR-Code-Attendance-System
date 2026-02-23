// === KONFIGURASI ===
const SHEET_TOKENS   = "tokens";    // pastikan nama sheet persis lowercase ini
const SHEET_PRESENCE = "presence";  // pastikan nama sheet persis lowercase ini

// === HELPER ===
function response(ok, data = null, error = null) {
  const output = ok ? { ok: true, data } : { ok: false, error };
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function generateToken() {
  return "TKN-" + Utilities.getUuid().slice(0, 6).toUpperCase();
}

// === ROUTER UTAMA ===
function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return response(false, null, "no_post_data");
    }

    const body = JSON.parse(e.postData.contents);
    const action = e.parameter.action || "";

    if (action === "generate") {
      return generateQR(body);
    }
    if (action === "checkin") {
      return checkin(body);
    }

    return response(false, null, "endpoint_not_found");
  } catch (err) {
    return response(false, null, "server_error: " + err.message);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action || "";

    if (action === "status") {
      return getStatus(e.parameter);
    }

    return response(false, null, "endpoint_not_found");
  } catch (err) {
    return response(false, null, "server_error: " + err.message);
  }
}

// === ENDPOINT: Generate QR Token (expire 5 menit, ts otomatis) ===
function generateQR(body) {
  const { course_id, session_id } = body;
  if (!course_id || !session_id) {
    return response(false, null, "missing_field: course_id, session_id");
  }

  const now = new Date();
  const ts = now.toISOString(); // waktu server otomatis

  const qr_token = generateToken();
  const expires_at = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5 menit

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TOKENS);
  if (!sheet) {
    return response(false, null, "sheet_not_found: tokens");
  }

  sheet.appendRow([qr_token, course_id, session_id, expires_at, ts]);

  return response(true, {
    qr_token,
    expires_at
  });
}

// === ENDPOINT: Check-in (ts otomatis) ===
function checkin(body) {
  const { user_id, device_id, course_id, session_id, qr_token } = body;
  if (!user_id || !device_id || !course_id || !session_id || !qr_token) {
    return response(false, null, "missing_field");
  }

  const now = new Date();
  const ts = now.toISOString(); // waktu check-in otomatis

  const tokenSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TOKENS);
  if (!tokenSheet) {
    return response(false, null, "sheet_not_found: tokens");
  }

  const tokenData = tokenSheet.getDataRange().getValues();
  let validToken = null;
  for (let i = 1; i < tokenData.length; i++) {
    if (tokenData[i][0] === qr_token &&
        tokenData[i][1] === course_id &&
        tokenData[i][2] === session_id) {
      validToken = tokenData[i];
      break;
    }
  }

  if (!validToken) {
    return response(false, null, "token_invalid");
  }

  const expiresAt = new Date(validToken[3]);
  if (now > expiresAt) {
    return response(false, null, "token_expired");
  }

  // Cek duplikat check-in
  const presenceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRESENCE);
  if (!presenceSheet) {
    return response(false, null, "sheet_not_found: presence");
  }

  const presenceData = presenceSheet.getDataRange().getValues();
  for (let i = 1; i < presenceData.length; i++) {
    if (String(presenceData[i][1]).trim() === String(user_id).trim() &&
        String(presenceData[i][3]).trim() === String(course_id).trim() &&
        String(presenceData[i][4]).trim() === String(session_id).trim()) {
      return response(false, null, "already_checked_in");
    }
  }

  const presenceId = "PR-" + Utilities.getUuid().slice(0, 8).toUpperCase();
  presenceSheet.appendRow([
    presenceId,
    user_id,
    device_id,
    course_id,
    session_id,
    qr_token,
    "checked_in",
    ts
  ]);

  return response(true, {
    presence_id: presenceId,
    status: "checked_in"
  });
}

// === ENDPOINT: Cek Status (handle string/number mismatch) ===
function getStatus(params) {
  const { user_id, course_id, session_id } = params;
  if (!user_id || !course_id || !session_id) {
    return response(false, null, "missing_field: user_id, course_id, session_id");
  }

  // Paksa semua jadi string + trim
  const searchUser   = String(user_id).trim();
  const searchCourse = String(course_id).trim();
  const searchSession = String(session_id).trim();

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRESENCE);
  if (!sheet) {
    return response(false, null, "sheet_not_found: presence");
  }

  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    const rowUser   = String(data[i][1]).trim(); // kolom B
    const rowCourse = String(data[i][3]).trim(); // kolom D
    const rowSession = String(data[i][4]).trim(); // kolom E

    if (rowUser === searchUser &&
        rowCourse === searchCourse &&
        rowSession === searchSession) {
      return response(true, {
        user_id: searchUser,
        course_id: searchCourse,
        session_id: searchSession,
        status: data[i][6],
        last_ts: data[i][7]
      });
    }
  }

  return response(true, {
    user_id: searchUser,
    course_id: searchCourse,
    session_id: searchSession,
    status: "not_checked_in",
    last_ts: null
  });
}