alter table public.characters
  add column nivel20_url text not null default ''
  check (
    length(nivel20_url) <= 2048
    and (nivel20_url = '' or nivel20_url ~ '^https://(www\.)?nivel20\.com/[A-Za-z0-9][^[:space:][:cntrl:]]*$')
  );

grant insert (nivel20_url), update (nivel20_url) on public.characters to authenticated;
