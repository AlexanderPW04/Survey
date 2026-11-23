import hmac
import secrets
import time
from collections import OrderedDict
from threading import Lock

from fastapi import HTTPException, Request

SESSION_AGE = 4 * 60 * 60
ATTEMPTS = 8
WINDOW_SECONDS = 10 * 60


class PasswordAttempts:
    def __init__(self):
        self.clients = OrderedDict()
        self.lock = Lock()

    def consume(self, key):
        now = time.monotonic()
        with self.lock:
            start, count = self.clients.get(key, (now, 0))
            if now - start >= WINDOW_SECONDS:
                start, count = now, 0
            if count >= ATTEMPTS:
                retry = max(1, int(WINDOW_SECONDS - (now - start)) + 1)
                raise HTTPException(429, "Too many attempts. Try again later.", headers={"Retry-After": str(retry)})
            self.clients[key] = (start, count + 1)
            self.clients.move_to_end(key)
            if len(self.clients) > 4096:
                self.clients.popitem(last=False)

    def reset(self, key):
        with self.lock:
            self.clients.pop(key, None)


def equal_secret(first: str, second: str):
    return hmac.compare_digest(first.encode("utf-8"), second.encode("utf-8"))


def start_session(request: Request):
    request.session.clear()
    request.session.update(csrf=secrets.token_urlsafe(32), expires=int(time.time()) + SESSION_AGE)
    return {"csrf": request.session["csrf"]}


def require_admin(request: Request):
    csrf = request.session.get("csrf")
    expires = request.session.get("expires", 0)
    if not csrf or expires <= time.time():
        if request.session:
            request.session.clear()
        raise HTTPException(401, "Enter the admin password.")
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not equal_secret(
        request.headers.get("X-CSRF-Token", ""), csrf
    ):
        raise HTTPException(403, "Admin session check failed. Reload and try again.")
