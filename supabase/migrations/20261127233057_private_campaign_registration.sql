-- Signup validates the invitation server-side in the existing Auth trigger.
-- Viewing the registration form requires no access to campaign metadata.
revoke execute on function public.registration_campaign(text) from public, anon, authenticated;
