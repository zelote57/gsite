const BASE_API_URL =
  "https://api-ra-b0bacqgeeebmave4.brazilsouth-01.azurewebsites.net";

async function callApiWithoutCookie() {
  try {
    const url = `${BASE_API_URL}/api/hi`;

    const result = await fetchData(url, null, "POST", false);

    showResponse(result?.result?.message || "Error en la respuesta", "black");
  } catch (error) {
    showResponse("Error al conectar con la API", "red");
    console.error("Error:", error);
  }
}

async function fetchData(
  url,
  params = null,
  method = "GET",
  handleRedirect = true
) {
  try {
    const options = {
      method: method,
      headers: {},
    };

    const token = sessionStorage.getItem("authToken");
    if (token) {
      options.headers["Authorization"] = `Bearer ${token}`;
    }

    if (params) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(params);
    }

    const response = await fetch(url, options);
    console.log(`HTTP Status: ${response.status}`); // Log del estado HTTP

    if (response.status !== 200 && handleRedirect) {
      console.log("Redirección a mantenimiento");
      return;
    }

    let data = null;

    try {
      data = await response.json();
    } catch (parseError) {
      console.error("Error parsing response as JSON:", parseError);
      data = null;
    }

    if (!response.ok) {
      return data || { errorMessage: `API error: ${response.status}` };
    }

    return data;
  } catch (error) {
    console.error(`Error fetching data from ${url}:`, error);
    if (handleRedirect) {
      console.log("Redirección a mantenimiento");
      return;
    }
    return { errorMessage: "Error interno al intentar obtener datos." };
  }
}

function showResponse(message, color) {
  const responseElement = document.getElementById("response");
  responseElement.innerText = message;
  responseElement.style.color = color;
}

// Variables globales para controlar los reintentos
let consecutiveRetryCount = 0;
const MAX_CONSECUTIVE_RETRIES = 5;

async function initAuth() {
  console.log("initAuth() -> Iniciando proceso de autenticación...");
  let token = sessionStorage.getItem("authToken");
  if (token) {
    console.log("initAuth() -> Token encontrado en sessionStorage:", token);
  } else {
    console.log("initAuth() -> No se encontró token, solicitando inicial...");
    token = await fetchInitialTokens();
    if (!token) {
      console.warn(
        "initAuth() -> No se pudo obtener un token, procediendo a logout."
      );
      logoutUser();
      return null;
    }
  }
  // Si la autenticación es exitosa, se resetea el contador de reintentos
  consecutiveRetryCount = 0;
  console.log("initAuth() -> Token obtenido, programando refresco automático.");
  startRefreshScheduler(token);
  return token;
}

async function fetchInitialTokens() {
  console.log("fetchInitialTokens() -> Solicitando tokens iniciales...");
  try {
    const challengeResp = await fetch(`${BASE_API_URL}/api/auth/challenge`, {
      method: "GET",
      credentials: "include",
    });
    const challengeData = await handleApiResponse(challengeResp);
    if (!challengeData) return null;

    const validateResp = await fetch(`${BASE_API_URL}/api/auth/validate`, {
      method: "POST",
      credentials: "include",
    });
    const validateData = await handleApiResponse(validateResp);
    if (!validateData || !validateData.result?.token) return null;

    const newToken = validateData.result.token;
    console.log(
      "fetchInitialTokens() -> Token guardado en sessionStorage:",
      newToken
    );
    sessionStorage.setItem("authToken", newToken);
    return newToken;
  } catch (error) {
    console.error("fetchInitialTokens() -> Error en autenticación:", error);
    return null;
  }
}

function startRefreshScheduler(currentToken) {
  console.log(
    "startRefreshScheduler() -> Programando refresco para el token:",
    currentToken
  );
  const expiresInSec = getTokenRemainingTime(currentToken);
  console.log(
    "startRefreshScheduler() -> Tiempo de vida restante:",
    expiresInSec,
    "segundos"
  );
  if (expiresInSec <= 0) {
    console.warn(
      "startRefreshScheduler() -> Token expirado, refrescando de inmediato."
    );
    refreshToken();
    return;
  }
  const refreshBeforeExp = Math.max(expiresInSec - 60, 5);
  console.log(
    `startRefreshScheduler() -> Programando refresh en ${refreshBeforeExp} segundos.`
  );
  setTimeout(() => {
    console.log(
      "startRefreshScheduler() -> Ejecutando refreshToken() programado."
    );
    refreshToken();
  }, refreshBeforeExp * 1000);
}

async function refreshToken(attempt = 1) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;
  console.log(
    `refreshToken() -> Intentando refrescar el token (Intento ${attempt})...`
  );
  try {
    const oldToken = sessionStorage.getItem("authToken");
    if (!oldToken) {
      console.warn("refreshToken() -> No hay token en sessionStorage.");
      return;
    }
    const refreshResp = await fetch(`${BASE_API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiredAccessToken: oldToken }),
    });
    const refreshData = await handleApiResponse(refreshResp, true);
    if (!refreshData) {
      if (attempt < MAX_RETRIES) {
        console.warn(
          `refreshToken() -> No se obtuvo respuesta válida, reintentando en ${
            RETRY_DELAY_MS / 1000
          } segundos...`
        );
        setTimeout(() => refreshToken(attempt + 1), RETRY_DELAY_MS);
      } else {
        console.error(
          "refreshToken() -> Máximo de reintentos alcanzado en refresh."
        );
        logoutUser();
      }
      return;
    }
    if (!refreshData.isSuccess || !refreshData.result?.token) {
      if (attempt < MAX_RETRIES) {
        console.warn(
          `refreshToken() -> Respuesta inesperada, reintentando en ${
            RETRY_DELAY_MS / 1000
          } segundos...`
        );
        setTimeout(() => refreshToken(attempt + 1), RETRY_DELAY_MS);
      } else {
        console.error(
          "refreshToken() -> Máximo de reintentos alcanzado en refresh."
        );
        logoutUser();
      }
      return;
    }
    const newToken = refreshData.result.token;
    console.log("refreshToken() -> Nuevo token guardado:", newToken);
    sessionStorage.setItem("authToken", newToken);
    console.log("refreshToken() -> Reprogramando refresh...");
    startRefreshScheduler(newToken);
  } catch (error) {
    console.error(
      `refreshToken() -> Excepción en refresh (Intento ${attempt}):`,
      error
    );
    if (attempt < MAX_RETRIES) {
      console.warn(
        `refreshToken() -> Reintentando en ${RETRY_DELAY_MS / 1000} segundos...`
      );
      setTimeout(() => refreshToken(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error(
        "refreshToken() -> Máximo de reintentos alcanzado en refresh."
      );
      logoutUser();
    }
  }
}

async function handleApiResponse(response, isRefresh = false) {
  console.log(
    `handleApiResponse() -> Procesando respuesta (status: ${response.status})`
  );
  if (!response.ok) {
    const errorData = await tryParseJson(response);
    console.error("handleApiResponse() -> Error en respuesta:", errorData);

    // Caso especial en refresh: si se recibe "token_still_valid", no se requiere renovar
    if (isRefresh && errorData?.result?.error_code === "token_still_valid") {
      console.warn(
        "handleApiResponse() -> El token aún es válido, no se requiere refresh."
      );
      return errorData;
    }

    // Lista de códigos críticos que requieren forzar el cierre de sesión
    const criticalErrors = [
      "refresh_window_expired",
      "invalid_refresh_token",
      "refresh_token_reused_too_soon",
      "missing_nonce",
      "invalid_nonce",
      "expired_nonce",
      "missing_refresh_token",
      "missing_access_token",
    ];

    if (
      errorData?.result?.error_code &&
      criticalErrors.includes(errorData.result.error_code)
    ) {
      console.warn("handleApiResponse() -> Error crítico detectado.");
      logoutUser();
      return null;
    }

    return errorData;
  }
  try {
    return await response.json();
  } catch (error) {
    console.error("handleApiResponse() -> Error al parsear JSON:", error);
    return null;
  }
}

function getTokenRemainingTime(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const decodedPayload = JSON.parse(atob(base64));
    if (!decodedPayload.exp) {
      console.warn(
        "getTokenRemainingTime() -> No se encontró 'exp' en el token."
      );
      return 0;
    }
    return decodedPayload.exp - Math.floor(Date.now() / 1000);
  } catch (err) {
    console.error(
      "getTokenRemainingTime() -> Error al decodificar token:",
      err
    );
    return 0;
  }
}

async function tryParseJson(response) {
  try {
    return await response.json();
  } catch {
    console.warn(
      "tryParseJson() -> No se pudo parsear la respuesta como JSON."
    );
    return null;
  }
}

/**
 * logoutUser(): Ahora incrementa un contador de reintentos consecutivos.
 * Si se han superado 5 reintentos, se redirige a una página de mantenimiento.
 * De lo contrario, se reintenta llamar a initAuth() después de un breve retardo.
 */
async function logoutUser() {
  console.warn("logoutUser() -> Eliminando token.");
  sessionStorage.removeItem("authToken");
  consecutiveRetryCount++;
  if (consecutiveRetryCount >= MAX_CONSECUTIVE_RETRIES) {
    console.error(
      "logoutUser() -> Se han realizado más de 5 reintentos consecutivos. Redirigiendo a la página de mantenimiento."
    );
    window.location.href = "/maintenance.html";
  } else {
    console.warn(
      `logoutUser() -> Reintentando autenticación (reintento ${consecutiveRetryCount}/${MAX_CONSECUTIVE_RETRIES}) en 3 segundos...`
    );
    setTimeout(() => initAuth(), 3000);
  }
}

// document.addEventListener("DOMContentLoaded", async () => {
//   console.log("DOMContentLoaded -> Ejecutando initAuth()...");
//   const token = await initAuth();
//   if (!token) {
//     console.warn(
//       "DOMContentLoaded -> No se pudo inicializar la autenticación."
//     );
//   } else {
//     console.log("DOMContentLoaded -> Autenticación exitosa. Token:", token);
//   }
// });
