// Do not expose provider bodies, URLs, prompts, keys or raw error causes in the UI.
const connectionCodes=new Set(['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const certificateCodes=new Set(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID']);
export function networkCode(error) {
  for(let current=error,depth=0;current&&depth<5;current=current.cause,depth++) {
    if(connectionCodes.has(current.code)||certificateCodes.has(current.code))return current.code;
    for(const child of current.errors||[])if(connectionCodes.has(child.code)||certificateCodes.has(child.code))return child.code;
  }
  return null;
}
export function isNetworkFailure(error) {
  return Boolean(networkCode(error))||(error?.name==='TypeError'&&['fetch failed','terminated'].includes(error.message));
}
export function retryableNetworkFailure(error) {
  const code=networkCode(error);
  return isNetworkFailure(error)&&!certificateCodes.has(code)&&!['ENOTFOUND','ECONNREFUSED'].includes(code);
}
export function networkFailure(error,provider) {
  const code=networkCode(error);
  const reason=certificateCodes.has(code)?'No se pudo verificar el certificado del servicio.':
    ['ENOTFOUND','EAI_AGAIN'].includes(code)?'No se pudo resolver la dirección del servicio.':
    ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)?'El servicio no respondió a tiempo.':
    code==='ECONNREFUSED'?'El servicio rechazó la conexión.':'La conexión se interrumpió antes de completar la respuesta.';
  return new Error('No se pudo conectar con '+provider+'. '+reason+' Tu mensaje se conserva; puedes reanudar el chat.');
}
export function providerHttpFailure(status,provider) {
  const reason=status===401?'La clave no fue aceptada; revísala en Configuración.':
    status===403?'Tu cuenta no tiene acceso a ese modelo o recurso.':
    status===429?'Se alcanzó el límite de peticiones simultáneas; espera y reanuda el chat.':
    [502,503,504].includes(status)?'El servicio o el modelo no está disponible temporalmente; puedes reanudar el chat.':
    status===400?'La petición no fue aceptada. Revisa el modelo, el contexto y sus ajustes.':
    'Comprueba el modelo y tu cuenta; puedes reanudar el chat.';
  const error=new Error(provider+' respondió HTTP '+status+'. '+reason);
  error.retryable=[408,502,503,504].includes(status);
  return error;
}
