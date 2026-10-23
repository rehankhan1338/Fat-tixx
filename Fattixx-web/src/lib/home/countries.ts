/* Countries for the phone number picker in the sign-up window: ISO code, calling code and name. The US comes first. */

export type Country = { code: string; dial: string; name: string };

const LIST = `US 1 United States|CA 1 Canada|GB 44 United Kingdom|AU 61 Australia|IE 353 Ireland|NZ 64 New Zealand|MX 52 Mexico|
AR 54 Argentina|AT 43 Austria|BS 1 Bahamas|BB 1 Barbados|BE 32 Belgium|BR 55 Brazil|BG 359 Bulgaria|CL 56 Chile|CN 86 China|
CO 57 Colombia|CR 506 Costa Rica|HR 385 Croatia|CY 357 Cyprus|CZ 420 Czechia|DK 45 Denmark|DO 1 Dominican Republic|EC 593 Ecuador|
EG 20 Egypt|SV 503 El Salvador|EE 372 Estonia|ET 251 Ethiopia|FI 358 Finland|FR 33 France|DE 49 Germany|GH 233 Ghana|GR 30 Greece|
GT 502 Guatemala|HT 509 Haiti|HN 504 Honduras|HK 852 Hong Kong|HU 36 Hungary|IS 354 Iceland|IN 91 India|ID 62 Indonesia|IL 972 Israel|
IT 39 Italy|JM 1 Jamaica|JP 81 Japan|JO 962 Jordan|KE 254 Kenya|KR 82 South Korea|KW 965 Kuwait|LV 371 Latvia|LB 961 Lebanon|
LT 370 Lithuania|LU 352 Luxembourg|MY 60 Malaysia|MT 356 Malta|MA 212 Morocco|NL 31 Netherlands|NI 505 Nicaragua|NG 234 Nigeria|
NO 47 Norway|PK 92 Pakistan|PA 507 Panama|PY 595 Paraguay|PE 51 Peru|PH 63 Philippines|PL 48 Poland|PT 351 Portugal|PR 1 Puerto Rico|
QA 974 Qatar|RO 40 Romania|SA 966 Saudi Arabia|SN 221 Senegal|RS 381 Serbia|SG 65 Singapore|SK 421 Slovakia|SI 386 Slovenia|
ZA 27 South Africa|ES 34 Spain|LK 94 Sri Lanka|SE 46 Sweden|CH 41 Switzerland|TW 886 Taiwan|TZ 255 Tanzania|TH 66 Thailand|
TT 1 Trinidad and Tobago|TR 90 Turkey|UG 256 Uganda|UA 380 Ukraine|AE 971 United Arab Emirates|UY 598 Uruguay|VE 58 Venezuela|
VN 84 Vietnam|ZM 260 Zambia|ZW 263 Zimbabwe`;

export const COUNTRIES: Country[] = LIST.split("|").map((s) => {
  const [code, dial, ...name] = s.trim().split(" ");
  return { code, dial, name: name.join(" ") };
});

/** 🇺🇸 from "US" */
export function flag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * The number as E.164: the country's calling code plus the national number without its trunk "0"
 * ("07700 900123" in the UK → "+447700900123"). A number typed with its own "+" is used as typed.
 */
export function toE164(country: Country, typed: string): string {
  const t = typed.trim();
  if (t.startsWith("+")) return `+${t.slice(1).replace(/\D/g, "")}`;
  let national = t.replace(/\D/g, "");
  // North American numbers typed with their leading 1
  if (country.dial === "1" && national.length === 11 && national.startsWith("1")) national = national.slice(1);
  else if (country.dial !== "1") national = national.replace(/^0+/, "");
  return `+${country.dial}${national}`;
}
