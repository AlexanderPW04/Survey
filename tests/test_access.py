import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from backend.access import PasswordAttempts, require_admin, start_session
from backend.forms import Password
from backend.routes import login, logout


def request(attempts, password=None):
    auth_headers = [(b"x-admin-request", b"1")]
    return Request({
        "type": "http", "method": "POST", "headers": auth_headers,
        "session": {}, "client": ("127.0.0.1", 12345),
        "app": SimpleNamespace(state=SimpleNamespace(attempts=attempts, admin_password=password)),
    })


def test_session_expiration_and_csrf():
    incoming = request(PasswordAttempts())
    with pytest.raises(HTTPException) as missing:
        require_admin(incoming)
    assert missing.value.status_code == 401
    token = start_session(incoming)["csrf"]
    with pytest.raises(HTTPException) as csrf:
        require_admin(incoming)
    assert csrf.value.status_code == 403
    incoming = Request({**incoming.scope, "headers": [(b"x-csrf-token", token.encode())]})
    require_admin(incoming)
    incoming.session["expires"] = time.time() - 1
    with pytest.raises(HTTPException) as expired:
        require_admin(incoming)
    assert expired.value.status_code == 401
    assert incoming.session == {}


def test_password_failure_throttles_and_logout_clears():
    attempts = PasswordAttempts()
    incoming = request(attempts, "synthetic-test-password")
    for _ in range(8):
        with pytest.raises(HTTPException) as failure:
            login(Password(password="wrong"), incoming)
        assert failure.value.status_code == 401
    with pytest.raises(HTTPException) as blocked:
        login(Password(password="synthetic-test-password"), incoming)
    assert blocked.value.status_code == 429
    assert int(blocked.value.headers["Retry-After"]) > 0
    attempts.reset("127.0.0.1")
    assert login(Password(password="synthetic-test-password"), incoming)["csrf"] == incoming.session["csrf"]
    logout(incoming)
    assert incoming.session == {}
