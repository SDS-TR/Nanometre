#!/usr/bin/env python3
"""Construit le jeu de seed à partir de data/admin_data.json.

Écrit src/data/seed.normalized.json (lu par l'app en mode local),
supabase/seed.catalogue.sql (salon, sans comptes) et supabase/seed.demo.sql
(comptes, profils et rendez-vous fictifs, local seulement).
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADMIN = json.loads((ROOT / "data" / "admin_data.json").read_text())

NS = uuid.UUID("40000000-0000-4000-8000-000000000000")


def bid(*parts: str) -> str:
    return str(uuid.uuid5(NS, "|".join(parts)))


def money(value: Decimal) -> int:
    return int((value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) * 100)


def line_taxes(cents: int) -> tuple[int, int, int]:
    price = Decimal(cents) / Decimal(100)
    gst = money(price * Decimal("0.05"))
    qst = money(price * Decimal("0.09975"))
    return gst, qst, cents + gst + qst


def late_fee(pre_tax: int) -> int:
    return money((Decimal(pre_tax) / Decimal(100)) * Decimal("0.5"))


def extract(fee_cents: int) -> tuple[int, int, int]:
    fee = Decimal(fee_cents) / Decimal(100)
    gst_base = (fee * Decimal(100) / Decimal(105)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    gst = (gst_base * Decimal("0.05")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    qst_base = (fee * Decimal(100) / Decimal("109.975")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    qst = (qst_base * Decimal("0.09975")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    gst_c = int(gst * 100)
    qst_c = int(qst * 100)
    return gst_c, qst_c, fee_cents - gst_c - qst_c


BARBERS = [
    {
        "id": "20000000-0000-4000-8000-000000000001",
        "slug": "karim-b",
        "fullName": "Karim B.",
        "shortName": "Karim",
        "specialty": "Dégradés précis",
        "bio": "Karim tient la chaise du fond depuis l'ouverture. Il prend son temps sur les fondus et laisse la nuque impeccable.",
        "years": 8,
        "photo": "karim-b",
        "sortOrder": 1,
    },
    {
        "id": "20000000-0000-4000-8000-000000000002",
        "slug": "julien-morel",
        "fullName": "Julien Morel",
        "shortName": "Julien",
        "specialty": "Coupe et barbe",
        "bio": "Julien aime les rendez-vous complets : une coupe qui tient la semaine et une barbe dessinée au rasoir.",
        "years": 6,
        "photo": "julien-morel",
        "sortOrder": 2,
    },
    {
        "id": "20000000-0000-4000-8000-000000000003",
        "slug": "samuel-tremblay",
        "fullName": "Samuel Tremblay",
        "shortName": "Samuel",
        "specialty": "Classiques nettes",
        "bio": "Samuel vient de Limoilou. Il coupe court, propre, et discute autant que le client en a envie.",
        "years": 5,
        "photo": "samuel-tremblay",
        "sortOrder": 3,
    },
    {
        "id": "20000000-0000-4000-8000-000000000004",
        "slug": "ousmane-diallo",
        "fullName": "Ousmane Diallo",
        "shortName": "Ousmane",
        "specialty": "Textures et contours",
        "bio": "Ousmane travaille les cheveux texturés et les lignes franches. Il explique chaque étape avant de sortir la tondeuse.",
        "years": 7,
        "photo": "ousmane-diallo",
        "sortOrder": 4,
    },
    {
        "id": "20000000-0000-4000-8000-000000000005",
        "slug": "marco-rossi",
        "fullName": "Marco Rossi",
        "shortName": "Marco",
        "specialty": "Rasage à l'ancienne",
        "bio": "Marco ferme souvent la journée avec un rasage serviette chaude. Le geste est lent, le résultat est lisse.",
        "years": 11,
        "photo": "marco-rossi",
        "sortOrder": 5,
    },
]

SERVICES = [
    {
        "id": "30000000-0000-4000-8000-000000000001",
        "slug": "coupe-classique",
        "name": "Coupe classique",
        "description": "Ciseaux et tondeuse, contours nets, coiffage simple.",
        "durationMinutes": 30,
        "priceCents": 3500,
        "photo": "coupe-classique",
        "sortOrder": 1,
    },
    {
        "id": "30000000-0000-4000-8000-000000000002",
        "slug": "degrade-blanc",
        "name": "Dégradé à blanc",
        "description": "Fondu progressif jusqu'au ras, ligne précise à la tempe.",
        "durationMinutes": 45,
        "priceCents": 4000,
        "photo": "degrade-blanc",
        "sortOrder": 2,
    },
    {
        "id": "30000000-0000-4000-8000-000000000003",
        "slug": "coupe-barbe",
        "name": "Coupe + barbe",
        "description": "La coupe et la taille de barbe dans le même rendez-vous.",
        "durationMinutes": 60,
        "priceCents": 5500,
        "photo": "coupe-barbe",
        "sortOrder": 3,
    },
    {
        "id": "30000000-0000-4000-8000-000000000004",
        "slug": "taille-barbe",
        "name": "Taille de barbe",
        "description": "Lignes, joues et cou, finition à l'huile.",
        "durationMinutes": 20,
        "priceCents": 2500,
        "photo": "taille-barbe",
        "sortOrder": 4,
    },
    {
        "id": "30000000-0000-4000-8000-000000000005",
        "slug": "rasage-ancienne",
        "name": "Rasage à l'ancienne",
        "description": "Serviette chaude, rasoir de barbier et baume.",
        "durationMinutes": 40,
        "priceCents": 4500,
        "photo": "rasage-ancienne",
        "sortOrder": 5,
    },
    {
        "id": "30000000-0000-4000-8000-000000000006",
        "slug": "coupe-enfant",
        "name": "Coupe enfant",
        "description": "Pour les moins de 12 ans, avec un parent à côté du fauteuil.",
        "durationMinutes": 30,
        "priceCents": 2500,
        "photo": "coupe-enfant",
        "sortOrder": 6,
    },
]

BARBER_BY_NAME = {barber["fullName"]: barber for barber in BARBERS}
SERVICE_BY_NAME = {service["name"]: service for service in SERVICES}
RATINGS = ADMIN["rev_barber"]

ALEX_ID = "11111111-1111-4111-8111-111111111111"
KARIM_USER = "22222222-2222-4222-8222-222222222222"
JULIEN_USER = "33333333-3333-4333-8333-333333333333"

USERS = [
    {
        "id": ALEX_ID,
        "email": "alex.gagnon@exemple.ca",
        "password": "nanometre",
        "fullName": "Alex Gagnon",
        "role": "client",
        "barberId": None,
        "phone": "418 555-0142",
    },
    {
        "id": KARIM_USER,
        "email": "karim@lenanometre.ca",
        "password": "nanometre",
        "fullName": "Karim B.",
        "role": "proprietaire",
        "barberId": BARBER_BY_NAME["Karim B."]["id"],
        "phone": "418 555-0101",
    },
    {
        "id": JULIEN_USER,
        "email": "julien.morel@lenanometre.ca",
        "password": "nanometre",
        "fullName": "Julien Morel",
        "role": "coiffeur",
        "barberId": BARBER_BY_NAME["Julien Morel"]["id"],
        "phone": "418 555-0102",
    },
]

CLIENT_IDS = {"Alex Gagnon": ALEX_ID}


def parse_label(label: str) -> int:
    cleaned = label.replace("\u00a0", " ")
    hour, minute = cleaned.split("h")
    return int(hour.strip()) * 60 + int(minute.strip())


def payment_fields(pre_tax: int, method: str, status: str, pay_status: str) -> dict:
    gst, qst, total = line_taxes(pre_tax)
    fee = fee_gst = fee_qst = fee_ht = refunded = 0
    payment_status = pay_status
    if status == "annule":
        payment_status = "rembourse" if method == "en_ligne" and pay_status == "paye" else "a_encaisser"
        refunded = total if payment_status == "rembourse" else 0
        if payment_status != "rembourse":
            payment_status = "echoue"
            refunded = 0
    elif status == "annule_tardif":
        if method == "en_ligne" and pay_status == "paye":
            fee = late_fee(pre_tax)
            fee_gst, fee_qst, fee_ht = extract(fee)
            refunded = total - fee
            payment_status = "rembourse_partiel"
        else:
            payment_status = "echoue"
    return {
        "priceCents": pre_tax,
        "gstCents": gst,
        "qstCents": qst,
        "totalCents": total,
        "paymentStatus": payment_status,
        "refundedCents": refunded,
        "feeCents": fee,
        "feeGstCents": fee_gst,
        "feeQstCents": fee_qst,
        "feeHtCents": fee_ht,
    }


bookings: list[dict] = []
seen: set[str] = set()


def add_booking(
    *,
    date: str,
    start: int,
    duration: int,
    service_name: str,
    barber_name: str,
    client_name: str,
    status: str,
    method: str,
    pay_status: str,
) -> None:
    service = SERVICE_BY_NAME[service_name]
    barber = BARBER_BY_NAME[barber_name]
    key = f"{date}|{start}|{barber['id']}|{client_name}|{service['id']}"
    if key in seen:
        return
    seen.add(key)
    fields = payment_fields(service["priceCents"], method, status, pay_status)
    bookings.append(
        {
            "id": bid(date, str(start), barber["slug"], client_name, service["slug"], status),
            "clientId": CLIENT_IDS.get(client_name),
            "clientName": client_name,
            "barberId": barber["id"],
            "serviceId": service["id"],
            "date": date,
            "startMinute": start,
            "durationMinutes": duration,
            "paymentMethod": method,
            "status": status,
            "loyaltyRedeemed": False,
            **fields,
        }
    )


for row in ADMIN["today"]:
    barber, label, duration, service, client, status, method = row
    mapped = {"honore": "honore", "annule": "annule", "annule_tardif": "annule_tardif"}[status]
    pay = "en_ligne" if method == "enLigne" else "sur_place"
    paid = "paye" if mapped == "honore" or pay == "en_ligne" else "a_encaisser"
    add_booking(
        date="2026-10-03",
        start=parse_label(label),
        duration=duration,
        service_name=service,
        barber_name=barber,
        client_name=client,
        status=mapped,
        method=pay,
        pay_status=paid,
    )

for row in ADMIN["day6"]:
    barber, start, duration, service, client, method, pay_status = row
    add_booking(
        date="2026-10-06",
        start=start,
        duration=duration,
        service_name=service,
        barber_name=barber,
        client_name=client,
        status="confirme",
        method="en_ligne" if method == "enLigne" else "sur_place",
        pay_status="paye" if pay_status == "paye" else "a_encaisser",
    )

for person in [ADMIN["alex"], *ADMIN["top_clients"]]:
    for item in person["history"]:
        date, service, barber, _total, state = item
        if state == "a_venir":
            status, pay_status = "confirme", "paye"
        else:
            status, pay_status = "honore", "paye"
        add_booking(
            date=date,
            start=10 * 60,
            duration=SERVICE_BY_NAME[service]["durationMinutes"],
            service_name=service,
            barber_name=barber,
            client_name=person["name"],
            status=status,
            method="en_ligne",
            pay_status=pay_status,
        )

for row in ADMIN["late_cb"]:
    date, label, client, barber, _total, _fee, _refund = row
    add_booking(
        date=date,
        start=parse_label(label),
        duration=60,
        service_name="Coupe + barbe",
        barber_name=barber,
        client_name=client,
        status="annule_tardif",
        method="en_ligne",
        pay_status="paye",
    )


def overlaps(a: dict, b: dict) -> bool:
    if a["date"] != b["date"] or a["barberId"] != b["barberId"]:
        return False
    if a["status"] in ("annule", "annule_tardif") or b["status"] in ("annule", "annule_tardif"):
        return False
    a0, a1 = a["startMinute"], a["startMinute"] + a["durationMinutes"]
    b0, b1 = b["startMinute"], b["startMinute"] + b["durationMinutes"]
    return a0 < b1 and b0 < a1


for index, booking in enumerate(bookings):
    shift = 0
    while any(overlaps(booking, other) for other in bookings[:index]):
        shift += 15
        booking["startMinute"] = 9 * 60 + ((booking["startMinute"] - 9 * 60 + 15) % (10 * 60))
        if shift > 40 * 15:
            break

active = [b for b in bookings if b["status"] not in ("annule", "annule_tardif")]
conflict = 0
for i, a in enumerate(active):
    for b in active[i + 1 :]:
        if overlaps(a, b):
            conflict += 1
if conflict:
    raise SystemExit(f"{conflict} chevauchements dans le seed")

reviews = []
for review in ADMIN["reviews"]:
    reviews.append(
        {
            "id": bid("review", review["client"], review["barber"], review["date"], review["text"][:24]),
            "barberId": BARBER_BY_NAME[review["barber"]]["id"],
            "serviceId": SERVICE_BY_NAME[review["service"]]["id"],
            "clientName": review["client"],
            "serviceName": review["service"],
            "stars": review["stars"],
            "body": review["text"],
            "status": "publie" if review["status"] == "publie" else "en_attente",
            "date": review["date"],
        }
    )

for barber in BARBERS:
    rating, count = RATINGS[barber["fullName"]]
    barber["rating"] = rating
    barber["reviewCount"] = count

promos = []
for code, promo in ADMIN["promos"].items():
    promos.append(
        {
            "code": code,
            "discountType": "percent" if promo["type"] == "%" else "amount",
            "value": promo["value"],
            "startsOn": promo["start"],
            "endsOn": promo["end"],
            "usageLimit": promo["limit"],
            "usageCount": ADMIN["promo_use"][code],
        }
    )

seed = {
    "salon": {
        "name": "Le Nanomètre",
        "tagline": "Barbier pour hommes",
        "address": "425, rue Saint-Vallier Ouest",
        "city": "Québec (Québec) G1K 1K8",
        "timezone": "America/Toronto",
        "openMinute": 540,
        "closeMinute": 1140,
        "gstNumber": "123456789 RT0001",
        "qstNumber": "1234567890 TQ0001",
        "taxNumbersPlaceholder": True,
        "phone": "418 555-0199",
    },
    "users": USERS,
    "barbers": BARBERS,
    "services": SERVICES,
    "loyalty": [
        {"clientId": ALEX_ID, "points": ADMIN["alex"]["points"], "stamps": ADMIN["alex"]["stamps"], "rewardsAvailable": 0}
    ],
    "bookings": bookings,
    "reviews": reviews,
    "promos": promos,
}

out = ROOT / "src" / "data" / "seed.normalized.json"
out.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n")
print(f"{len(bookings)} rendez-vous, {len(reviews)} avis → {out.relative_to(ROOT)}")


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_uuid(value: str | None) -> str:
    return "null" if value is None else f"{q(value)}::uuid"


lines = [
    "-- Généré par scripts/generate_seed.py — ne pas éditer à la main.",
    "insert into public.salon_settings (id, name, tagline, address, city, timezone, open_minute, close_minute, gst_number, qst_number, phone, tax_numbers_placeholder)",
    "values (1, 'Le Nanomètre', 'Barbier pour hommes', '425, rue Saint-Vallier Ouest', 'Québec (Québec) G1K 1K8', 'America/Toronto', 540, 1140, '123456789 RT0001', '1234567890 TQ0001', '418 555-0199', true)",
    "on conflict (id) do update set name = excluded.name;",
    "",
]

lines.append("insert into public.barbers (id, slug, full_name, short_name, specialty, bio, years, photo_path, rating, review_count, sort_order) values")
barber_rows = []
for barber in BARBERS:
    barber_rows.append(
        "("
        + ", ".join(
            [
                sql_uuid(barber["id"]),
                q(barber["slug"]),
                q(barber["fullName"]),
                q(barber["shortName"]),
                q(barber["specialty"]),
                q(barber["bio"]),
                str(barber["years"]),
                q(barber["photo"]),
                str(barber["rating"]),
                str(barber["reviewCount"]),
                str(barber["sortOrder"]),
            ]
        )
        + ")"
    )
lines.append(",\n".join(barber_rows) + " on conflict (id) do nothing;")
lines.append("")

lines.append("insert into public.services (id, slug, name, description, duration_minutes, price_cents, photo_path, sort_order) values")
service_rows = []
for service in SERVICES:
    service_rows.append(
        "("
        + ", ".join(
            [
                sql_uuid(service["id"]),
                q(service["slug"]),
                q(service["name"]),
                q(service["description"]),
                str(service["durationMinutes"]),
                str(service["priceCents"]),
                q(service["photo"]),
                str(service["sortOrder"]),
            ]
        )
        + ")"
    )
lines.append(",\n".join(service_rows) + " on conflict (id) do nothing;")
lines.append("")
lines.append("insert into public.barber_services (barber_id, service_id)")
lines.append("select b.id, s.id from public.barbers b cross join public.services s")
lines.append("on conflict do nothing;")
lines.append("")
lines.append("insert into public.schedules (barber_id, weekday, start_minute, end_minute)")
lines.append("select b.id, d.weekday, 540, 1140 from public.barbers b")
lines.append("cross join (values (2), (3), (4), (5), (6)) as d(weekday)")
lines.append("on conflict do nothing;")
lines.append("")

lines.append("insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count) values")
promo_rows = []
for promo in promos:
    promo_rows.append(
        "("
        + ", ".join(
            [
                q(promo["code"]),
                q(promo["discountType"]),
                str(promo["value"]),
                q(promo["startsOn"]),
                q(promo["endsOn"]),
                str(promo["usageLimit"]),
                str(promo["usageCount"]),
            ]
        )
        + ")"
    )
lines.append(",\n".join(promo_rows) + " on conflict (code) do nothing;")
lines.append("")

catalogue = [
    "-- Catalogue du salon. Aucun profil, aucun rendez-vous, aucun mot de passe.",
    "-- C'est le seul seed applicable à un projet hébergé, et encore : de préférence à la main.",
    "",
] + lines

# Auth users for local Supabase only. Written to seed.demo.sql, never to the hosted seed.
demo_lines = [
    "-- Comptes de démonstration. Uniquement `supabase db reset` en local.",
    "-- Ne jamais appliquer ce fichier sur un projet hébergé.",
    "",
    "do $$ begin",
]
for user in USERS:
    meta = json.dumps({"full_name": user["fullName"], "role": user["role"]}, ensure_ascii=False).replace("'", "''")
    demo_lines.append(
        f"""
  if not exists (select 1 from auth.users where id = '{user["id"]}') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '{user["id"]}', 'authenticated', 'authenticated',
      '{user["email"]}', crypt('{user["password"]}', gen_salt('bf')), now(),
      '{{"provider":"email","providers":["email"]}}'::jsonb, '{meta}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), '{user["id"]}',
      jsonb_build_object('sub', '{user["id"]}', 'email', '{user["email"]}'),
      'email', '{user["id"]}', now(), now(), now()
    );
  end if;"""
    )
demo_lines.append("exception when undefined_table then")
demo_lines.append("  raise notice 'auth.users absent — le seed local continue sans comptes Auth';")
demo_lines.append("end $$;")
demo_lines.append("")

demo_lines.append("insert into public.profiles (id, role, full_name, phone, barber_id, active) values")
profile_rows = []
for user in USERS:
    profile_rows.append(
        f"({sql_uuid(user['id'])}, {q(user['role'])}::public.user_role, {q(user['fullName'])}, {q(user['phone'])}, {sql_uuid(user['barberId'])}, true)"
    )
demo_lines.append(",\n".join(profile_rows))
demo_lines.append("on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, barber_id = excluded.barber_id;")
demo_lines.append("")
demo_lines.append(
    f"insert into public.loyalty_accounts (client_id, points, stamps, rewards_available) values ({sql_uuid(ALEX_ID)}, {ADMIN['alex']['points']}, {ADMIN['alex']['stamps']}, 0)"
)
demo_lines.append("on conflict (client_id) do update set points = excluded.points, stamps = excluded.stamps;")
demo_lines.append("")


def timestamptz(date: str, minute: int, plus_minutes: int = 0) -> str:
    total = minute + plus_minutes
    hour, mins = divmod(total, 60)
    return f"('{date} {hour:02d}:{mins:02d}:00 America/Toronto')::timestamptz"


demo_lines.append("insert into public.bookings (id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes, price_cents, gst_cents, qst_cents, total_cents, payment_method, status, loyalty_redeemed) values")
booking_rows = []
for booking in bookings:
    booking_rows.append(
        "("
        + ", ".join(
            [
                sql_uuid(booking["id"]),
                sql_uuid(booking["clientId"]),
                q(booking["clientName"]),
                sql_uuid(booking["barberId"]),
                sql_uuid(booking["serviceId"]),
                timestamptz(booking["date"], booking["startMinute"]),
                timestamptz(booking["date"], booking["startMinute"], booking["durationMinutes"]),
                str(booking["durationMinutes"]),
                str(booking["priceCents"]),
                str(booking["gstCents"]),
                str(booking["qstCents"]),
                str(booking["totalCents"]),
                f"{q(booking['paymentMethod'])}::public.payment_method",
                f"{q(booking['status'])}::public.booking_status",
                "false",
            ]
        )
        + ")"
    )
demo_lines.append(",\n".join(booking_rows) + " on conflict (id) do nothing;")
demo_lines.append("")

demo_lines.append("insert into public.payments (booking_id, method, status, amount_cents, refunded_cents, fee_cents, fee_gst_cents, fee_qst_cents, fee_ht_cents) values")
payment_rows = []
for booking in bookings:
    payment_rows.append(
        "("
        + ", ".join(
            [
                sql_uuid(booking["id"]),
                f"{q(booking['paymentMethod'])}::public.payment_method",
                f"{q(booking['paymentStatus'])}::public.payment_status",
                str(booking["totalCents"]),
                str(booking["refundedCents"]),
                str(booking["feeCents"]),
                str(booking["feeGstCents"]),
                str(booking["feeQstCents"]),
                str(booking["feeHtCents"]),
            ]
        )
        + ")"
    )
demo_lines.append(",\n".join(payment_rows) + ";")
demo_lines.append("")

demo_lines.append("insert into public.reviews (id, barber_id, service_id, client_name, stars, body, status, created_at) values")
review_rows = []
for review in reviews:
    review_rows.append(
        "("
        + ", ".join(
            [
                sql_uuid(review["id"]),
                sql_uuid(review["barberId"]),
                sql_uuid(review["serviceId"]),
                q(review["clientName"]),
                str(review["stars"]),
                q(review["body"]),
                f"{q(review['status'])}::public.review_status",
                f"{q(review['date'])}::date",
            ]
        )
        + ")"
    )
demo_lines.append(",\n".join(review_rows) + " on conflict (id) do nothing;")
demo_lines.append("")

stub = [
    "-- Ne pas exécuter ce fichier.",
    "-- Projet hébergé : seed.catalogue.sql seulement, et jamais seed.demo.sql.",
    "-- Local : supabase db reset applique le catalogue puis la démo.",
    "do $$ begin",
    "  raise exception 'seed.sql est retiré. Catalogue : seed.catalogue.sql. Démo locale : seed.demo.sql.';",
    "end $$;",
    "",
]
(ROOT / "supabase" / "seed.catalogue.sql").write_text("\n".join(catalogue) + "\n")
(ROOT / "supabase" / "seed.demo.sql").write_text("\n".join(demo_lines) + "\n")
(ROOT / "supabase" / "seed.sql").write_text("\n".join(stub) + "\n")
print(f"supabase/seed.catalogue.sql ({len(catalogue)} lignes)")
print(f"supabase/seed.demo.sql ({len(demo_lines)} lignes)")
