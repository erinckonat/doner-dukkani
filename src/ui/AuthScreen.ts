import { Account } from '../core/Account';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const GUEST_KEY = 'doner-guest';

/** Remembered "play without an account" choice on this device. */
export const guestMode = {
  get() { try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; } },
  set(on: boolean) { try { on ? localStorage.setItem(GUEST_KEY, '1') : localStorage.removeItem(GUEST_KEY); } catch { /* ignore */ } },
};

/** Sign-in / sign-up card shown before the game when served by the game server. */
export function showAuth(): Promise<{ email: string } | 'guest'> {
  const wrap = $('auth');
  const form = $<HTMLFormElement>('auth-form');
  const email = $<HTMLInputElement>('auth-email');
  const password = $<HTMLInputElement>('auth-password');
  const error = $('auth-error');
  const submit = $<HTMLButtonElement>('auth-submit');
  const tabs = { login: $<HTMLButtonElement>('auth-tab-login'), register: $<HTMLButtonElement>('auth-tab-register') };
  let mode: 'login' | 'register' = 'login';

  const setMode = (m: typeof mode) => {
    mode = m;
    tabs.login.setAttribute('aria-selected', String(m === 'login'));
    tabs.register.setAttribute('aria-selected', String(m === 'register'));
    password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    submit.textContent = m === 'login' ? TR.auth.login : TR.auth.register;
    error.textContent = '';
  };
  tabs.login.addEventListener('click', () => setMode('login'));
  tabs.register.addEventListener('click', () => setMode('register'));
  wrap.hidden = false;
  email.focus();

  return new Promise((resolve) => {
    $('auth-guest').addEventListener('click', () => {
      guestMode.set(true);
      wrap.hidden = true;
      resolve('guest');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      submit.textContent = TR.auth.working;
      const r = await Account.signIn(mode, email.value, password.value);
      submit.disabled = false;
      setMode(mode);
      if (r.error) {
        error.textContent = TR.auth.errors[r.error];
        return;
      }
      guestMode.set(false);
      wrap.hidden = true;
      resolve({ email: r.email! });
    });
  });
}
