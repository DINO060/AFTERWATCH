-- Supabase provides this extension; no external service or service key is used.
create schema if not exists extensions;
create extension if not exists pg_jsonschema with schema extensions;

-- Validate direct RPC calls as well as writes from the application's Zod layer.
-- This helper is private to the database owner and the guarded save function.
create function public.is_valid_watch_state(p_state jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  item jsonb;
begin
  if p_state is null or pg_catalog.octet_length(p_state::text) > 2000000 then
    return false;
  end if;
  if not extensions.jsonb_matches_schema(
$schema$
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "media",
    "sessions",
    "settings"
  ],
  "additionalProperties": false,
  "properties": {
    "media": {
      "type": "array",
      "maxItems": 1000,
      "items": {
        "$ref": "#/definitions/media"
      }
    },
    "sessions": {
      "type": "array",
      "maxItems": 5000,
      "items": {
        "$ref": "#/definitions/session"
      }
    },
    "settings": {
      "type": "object",
      "required": [
        "budget",
        "time",
        "days",
        "reminders",
        "timezone"
      ],
      "additionalProperties": false,
      "properties": {
        "budget": {
          "type": "integer",
          "minimum": 15,
          "maximum": 600
        },
        "time": {
          "$ref": "#/definitions/time"
        },
        "days": {
          "type": "array",
          "minItems": 1,
          "maxItems": 7,
          "items": {
            "type": "integer",
            "minimum": 0,
            "maximum": 6
          }
        },
        "reminders": {
          "type": "boolean"
        },
        "timezone": {
          "type": "string",
          "maxLength": 100,
          "minLength": 1
        }
      }
    }
  },
  "definitions": {
    "uuid": {
      "type": "string",
      "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    },
    "time": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
    },
    "media": {
      "type": "object",
      "required": [
        "id",
        "title",
        "kind",
        "priority",
        "status",
        "progress",
        "total",
        "duration",
        "poster",
        "sourceUrl",
        "notes"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/definitions/uuid"
        },
        "title": {
          "type": "string",
          "maxLength": 180,
          "minLength": 1,
          "pattern": "\\S"
        },
        "kind": {
          "enum": [
            "anime",
            "manga",
            "series",
            "film"
          ]
        },
        "priority": {
          "type": "boolean"
        },
        "status": {
          "enum": [
            "watching",
            "later",
            "paused",
            "completed"
          ]
        },
        "progress": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000
        },
        "total": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000
        },
        "duration": {
          "type": "integer",
          "minimum": 1,
          "maximum": 600
        },
        "poster": {
          "type": "string",
          "maxLength": 2000,
          "pattern": "^(?:$|https://(?:media\\.kitsu\\.app|media\\.kitsu\\.io|cdn\\.myanimelist\\.net|static\\.tvmaze\\.com|images\\.metahub\\.space|m\\.media-amazon\\.com|image\\.tmdb\\.org)/)"
        },
        "sourceUrl": {
          "type": "string",
          "maxLength": 2000,
          "pattern": "^(?:$|https://(?:kitsu\\.app|kitsu\\.io|myanimelist\\.net|www\\.tvmaze\\.com|www\\.imdb\\.com)/)"
        },
        "notes": {
          "type": "string",
          "maxLength": 2000
        },
        "catalog": {
          "$ref": "#/definitions/catalog"
        }
      }
    },
    "catalog": {
      "type": "object",
      "required": [
        "source",
        "id",
        "synopsis",
        "genres",
        "year",
        "score",
        "episodes",
        "chapters",
        "volumes",
        "seasons",
        "available",
        "releaseStatus",
        "format",
        "durationKnown"
      ],
      "additionalProperties": false,
      "properties": {
        "source": {
          "enum": [
            "jikan",
            "kitsu",
            "cinemeta",
            "tvmaze"
          ]
        },
        "id": {
          "type": "string",
          "maxLength": 50
        },
        "synopsis": {
          "type": "string",
          "maxLength": 12000
        },
        "genres": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 100
          }
        },
        "year": {
          "type": "string",
          "maxLength": 40
        },
        "score": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0,
          "maximum": 10
        },
        "episodes": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 100000
        },
        "chapters": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 100000
        },
        "volumes": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 100000
        },
        "seasons": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 10000
        },
        "available": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 100000
        },
        "releaseStatus": {
          "type": "string",
          "maxLength": 100
        },
        "format": {
          "type": "string",
          "maxLength": 100
        },
        "durationKnown": {
          "type": "boolean"
        }
      }
    },
    "session": {
      "type": "object",
      "required": [
        "id",
        "mediaId",
        "date",
        "time",
        "from",
        "to",
        "duration",
        "done"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "$ref": "#/definitions/uuid"
        },
        "mediaId": {
          "$ref": "#/definitions/uuid"
        },
        "date": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
        },
        "time": {
          "$ref": "#/definitions/time"
        },
        "from": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100000
        },
        "to": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100000
        },
        "duration": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1440
        },
        "done": {
          "type": "boolean"
        }
      }
    }
  }
}
$schema$::json, p_state) then
    return false;
  end if;

  if (select count(*) <> count(distinct value->>'id')
      from pg_catalog.jsonb_array_elements(p_state->'media'))
    or (select count(*) <> count(distinct value->>'id')
      from pg_catalog.jsonb_array_elements(p_state->'sessions')) then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_state->'media') as media(value)
    where (media.value->>'total')::numeric > 0
      and (media.value->>'progress')::numeric > (media.value->>'total')::numeric
  ) then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_state->'sessions') as session(value)
    left join pg_catalog.jsonb_array_elements(p_state->'media') as media(value)
      on media.value->>'id' = session.value->>'mediaId'
    where media.value is null
      or (session.value->>'to')::numeric < (session.value->>'from')::numeric
      or ((media.value->>'total')::numeric > 0
        and (session.value->>'to')::numeric > (media.value->>'total')::numeric)
  ) then
    return false;
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_state->'sessions') loop
    if pg_catalog.to_char((item->>'date')::date, 'YYYY-MM-DD') <> item->>'date' then
      return false;
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where pg_catalog.lower(name) = pg_catalog.lower(p_state#>>'{settings,timezone}')
  ) then
    return false;
  end if;
  return true;
exception
  when invalid_datetime_format or datetime_field_overflow
    or invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

revoke all on function public.is_valid_watch_state(jsonb) from public, anon, authenticated;

create table public.watch_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (public.is_valid_watch_state(data)),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);

alter table public.watch_states enable row level security;

-- Clients read their own rows and save through the guarded RPC exclusively.
-- Direct writes would bypass the expected revision check, so grant SELECT only.
revoke all on table public.watch_states from public, anon, authenticated;
grant select on table public.watch_states to authenticated;

create policy "Read own collection" on public.watch_states
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- SECURITY DEFINER is narrowly scoped: identity comes from auth.uid(), every
-- target is schema-qualified, and callers cannot choose the user_id to write.
-- The empty search_path prevents substituting objects in an accessible schema.
-- Null means the expected revision no longer matches (HTTP 409 in the app).
create function public.save_watch_state(p_state jsonb, p_revision bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  saved_revision bigint;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 0 or p_revision > 9007199254740991
    or not public.is_valid_watch_state(p_state) then
    raise exception 'Invalid collection or revision' using errcode = '22023';
  end if;

  if p_revision = 0 then
    insert into public.watch_states (user_id, data, revision, updated_at)
    values (caller_id, p_state, 1, pg_catalog.now())
    on conflict (user_id) do nothing
    returning revision into saved_revision;
  else
    update public.watch_states
    set data = p_state, revision = revision + 1, updated_at = pg_catalog.now()
    where user_id = caller_id and revision = p_revision
    returning revision into saved_revision;
  end if;

  return saved_revision;
end;
$$;

revoke all on function public.save_watch_state(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_watch_state(jsonb, bigint) to authenticated;
