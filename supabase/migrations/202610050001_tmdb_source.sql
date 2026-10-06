-- Accept titles added from TMDB (films and series): catalog source "tmdb" and
-- source links on www.themoviedb.org. Run once in the SQL Editor after
-- 202610040001_watch_states.sql. Same function and signature: the table's CHECK
-- constraint and the save function use it at once; existing rows are unchanged.
create or replace function public.is_valid_watch_state(p_state jsonb)
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
          "pattern": "^(?:$|https://(?:kitsu\\.app|kitsu\\.io|myanimelist\\.net|www\\.tvmaze\\.com|www\\.imdb\\.com|www\\.themoviedb\\.org)/)"
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
            "tvmaze",
            "tmdb"
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
