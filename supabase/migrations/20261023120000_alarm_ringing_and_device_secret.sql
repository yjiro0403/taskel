-- Let another Taskel client stop an alarm that is already ringing.
--
-- ringing_at stays null while the alarm is only armed. A device sets it at the
-- moment it starts sounding. status stays "scheduled" so other phones keep
-- their local AlarmManager entries until someone dismisses or snoozes.
--
-- device_secret_hash is the SHA-256 hex of a secret that lives only on the
-- device. The device uses it to report ring/dismiss/snooze while the WebView
-- is not running. The plaintext secret is never stored.

alter table public.alarms
    add column ringing_at timestamptz;

comment on column public.alarms.ringing_at is
    'When a device started sounding this alarm. Null means it is not currently ringing.';

alter table public.device_tokens
    add column device_secret_hash text;

comment on column public.device_tokens.device_secret_hash is
    'SHA-256 hex of the per-device alarm report secret. Null until the app registers one.';

-- Multiple rows may have no secret yet. A secret identifies one device.
create unique index device_tokens_device_secret_hash_idx
    on public.device_tokens (device_secret_hash)
    where device_secret_hash is not null;
