-- NestHire Workspace — strict external-link validation
--
-- Additive: replaces one private validation function; no schema object or
-- production record is dropped or rewritten. This closes the direct-RPC gap
-- where malformed authorities and ports passed the earlier scheme-only regex.

create or replace function private.is_safe_external_link(p_link text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
  v_host_for_labels text;
  v_port text;
  v_significant_port text;
  v_labels text[];
  v_label text;
  v_ip inet;
begin
  if p_link is null or char_length(p_link) > 2048 then
    return false;
  end if;

  -- No credentials, whitespace/control characters, or non-HTTPS schemes.
  if p_link !~* '^https://[^/?#@\s]+([/?#][^\s]*)?$' then
    return false;
  end if;
  if private.is_storage_link(p_link) then
    return false;
  end if;

  v_authority := substring(lower(p_link) from '^https://([^/?#]+)');
  if v_authority is null or v_authority = '' then
    return false;
  end if;

  if left(v_authority, 1) = '[' then
    -- IPv6 literals must be bracketed and accepted by PostgreSQL's inet parser.
    if v_authority !~ '^\[[0-9a-f:.]+\](:[0-9]+)?$' then
      return false;
    end if;
    v_host := substring(v_authority from '^\[([0-9a-f:.]+)\]');
    v_port := substring(v_authority from '^\[[0-9a-f:.]+\]:([0-9]+)$');
    begin
      v_ip := v_host::inet;
    exception when others then
      return false;
    end;
    if family(v_ip) <> 6 then
      return false;
    end if;
  else
    if strpos(v_authority, ':') > 0 then
      if v_authority !~ '^[^:]+:[0-9]+$' then
        return false;
      end if;
      v_port := substring(v_authority from ':([0-9]+)$');
      v_host := left(v_authority, char_length(v_authority) - char_length(v_port) - 1);
    else
      v_host := v_authority;
    end if;

    if v_host is null or v_host = '' or char_length(v_host) > 254
       or v_host ~ '[^[:alnum:].-]'
       or v_host ~ '\.\.'
       or v_host ~ '(^|\.)-|-(\.|$)' then
      return false;
    end if;

    v_host_for_labels := case
      when right(v_host, 1) = '.' then left(v_host, char_length(v_host) - 1)
      else v_host
    end;
    if v_host_for_labels = '' or char_length(v_host_for_labels) > 253 then
      return false;
    end if;

    v_labels := string_to_array(v_host_for_labels, '.');
    foreach v_label in array v_labels loop
      if char_length(v_label) > 63
         or v_label !~ '^[[:alnum:]]([[:alnum:]-]{0,61}[[:alnum:]])?$' then
        return false;
      end if;
    end loop;

    -- Reject numeric hosts that are not valid IPv4 addresses (WHATWG URL parsing
    -- treats all-numeric dotted hosts as IP literals, not DNS names).
    if v_host ~ '^[0-9.]+$' then
      begin
        v_ip := v_host::inet;
      exception when others then
        return false;
      end;
      if family(v_ip) <> 4 or masklen(v_ip) <> 32 then
        return false;
      end if;
    end if;
  end if;

  if v_port is not null then
    -- Allow leading zeroes as URL parsers do, but bound the normalized port.
    v_significant_port := nullif(ltrim(v_port, '0'), '');
    if coalesce(char_length(v_significant_port), 0) > 5
       or coalesce(v_significant_port::integer, 0) > 65535 then
      return false;
    end if;
  end if;

  return true;
end;
$$;
