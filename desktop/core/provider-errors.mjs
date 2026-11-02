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
  const reason=certificateCodes.has(code)?'Could not verify the service TLS certificate.':
    ['ENOTFOUND','EAI_AGAIN'].includes(code)?'Could not resolve the service host address.':
    ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)?'The service did not respond in time.':
    code==='ECONNREFUSED'?'The service refused the connection.':'The connection was interrupted before completing the response.';
  return new Error('Could not connect to '+provider+'. '+reason+' Your message is preserved; you can resume the chat.');
}
export function providerHttpFailure(status,provider) {
  const reason=status===401?'The API key or token was rejected; check it in Settings.':
    status===403?'Your account does not have access to this model or resource.':
    status===429?'Rate or concurrency limit reached; wait a moment and resume the chat.':
    [502,503,504].includes(status)?'The service or model is temporarily unavailable; you can resume the chat.':
    status===400?'The request was rejected by the provider. Check the model ID, context window, and parameters.':
    'Check the model and your account status; you can resume the chat.';
  const error=new Error(provider+' returned HTTP '+status+'. '+reason);
  error.retryable=[408,502,503,504].includes(status);
  return error;
}
