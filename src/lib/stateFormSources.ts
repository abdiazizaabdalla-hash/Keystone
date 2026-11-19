// Where to find each state's real-estate forms. Relay stores no copies: every entry is a link to the source's own page,
// which the source keeps current. Entries were opened and read by hand (see CHECKED); a source is listed only if it
// loaded and showed real forms or a real forms list. Texas is separate (it has its own live TREC catalog).
//
// "tier" says how much the state itself publishes:
//   contracts   - the state publishes the main purchase contract (and more)
//   disclosures - the state publishes some official transaction documents (agency, property condition, listing or
//                 buyer-agency forms) but the main contract comes from an association
//   association - the state publishes none that we could confirm; the contracts come from a REALTOR association
//   none        - nothing public could be confirmed
// Pure module: no supabase import (used by unit tests and the browser).

export const FORM_SOURCES_CHECKED = '2026-11-03';

export type SourceType = 'state' | 'association' | 'other';
export type SourceAccess = 'public' | 'members' | 'paid' | 'mixed';
export type StateTier = 'contracts' | 'disclosures' | 'association' | 'none';

export interface FormSource {
  /** Stable id, e.g. "co-dre". Used when a source is added to a folder. */
  id: string;
  state: string;
  label: string;
  url: string;
  type: SourceType;
  access: SourceAccess;
  /** What is there, in plain words. */
  covers: string;
  note?: string;
}

export interface StateFormInfo {
  tier: StateTier;
  /** One honest sentence about the state as a whole. */
  summary: string;
  sources: Omit<FormSource, 'state'>[];
}

const src = (id: string, label: string, url: string, type: SourceType, access: SourceAccess, covers: string, note?: string) => ({ id, label, url, type, access, covers, note });

export const STATE_FORM_INFO: Record<string, StateFormInfo> = {
  AL: {
    tier: 'association',
    summary: 'The state commission publishes licensing forms only. Contracts come from Alabama REALTORS and are free to members or sold to other licensees.',
    sources: [src('al-aar', 'Alabama REALTORS legal forms (2026 preview)', 'https://www.alabamarealtors.com/statewide-legal-forms/2026-legal-forms-preview', 'association', 'paid', 'Listing, buyer agency, purchase agreement, property condition disclosure, addenda', 'The page lists form names and revision dates; the forms themselves need membership or a paid subscription.')],
  },
  AK: {
    tier: 'disclosures',
    summary: 'The state commission publishes the seller disclosure statement and the agency pamphlet and waiver. Purchase contracts and listing agreements: nothing verified.',
    sources: [
      src('ak-rec', 'Alaska Real Estate Commission: consumer forms', 'https://commerce.alaska.gov/web/cbpl/ProfessionalLicensing/RealEstateCommission/ConsumerInformation/Forms', 'state', 'public', 'Residential real property transfer disclosure, agency consumer pamphlet, waiver of right to be represented'),
      src('ak-4229', 'Transfer Disclosure Statement (Form 08-4229)', 'https://commerce.alaska.gov/web/Portals/5/pub/rec4229.pdf', 'state', 'public', 'The seller’s property disclosure, revised 05/2024'),
    ],
  },
  AZ: {
    tier: 'association',
    summary: 'The state department publishes licensing forms only. Contracts come from Arizona REALTORS.',
    sources: [src('az-aar', 'Arizona REALTORS standard forms catalog', 'https://www.aaronline.com/manage-risk/sample-forms/aar-brings-you-standard-forms/', 'association', 'mixed', 'Residential resale purchase contract, seller property disclosure, buyer-broker agreement, agency disclosure', 'The catalog is public; the usable forms are most likely for members only.')],
  },
  AR: {
    tier: 'association',
    summary: 'The state commission publishes licensing forms only. Contracts come from Arkansas REALTORS (members area or paid).',
    sources: [src('ar-ara', 'Arkansas REALTORS form changes', 'https://www.arkansasrealtors.com/form-changes', 'association', 'members', 'Purchase and listing form updates', 'Members area. No individual forms were visible without logging in.')],
  },
  CA: {
    tier: 'association',
    summary: 'The Department of Real Estate has no transaction forms. The standard California contracts are C.A.R. forms, paid or for members.',
    sources: [src('ca-car', 'C.A.R. sample forms book', 'https://store.car.org/products/sample-forms-book-january-2026', 'association', 'paid', 'About 260 C.A.R. forms including the purchase agreement and listing agreement', 'A paid product page. Individual forms cannot be linked.')],
  },
  CO: {
    tier: 'contracts',
    summary: 'The Division of Real Estate publishes the Commission-approved contracts, listings, addenda and disclosures, free, with effective dates in the form names.',
    sources: [src('co-dre', 'Colorado Division of Real Estate: contracts and forms', 'https://dre.colorado.gov/real-estate-broker-contracts-and-forms', 'state', 'public', 'Purchase contracts, listing contracts, addenda, seller property disclosure, lead paint, brokerage disclosures', 'Brokers must use Commission-approved forms. Most are marked “for use on and after January 1, 2026”; a 2027 set is posted for preview.')],
  },
  CT: {
    tier: 'disclosures',
    summary: 'The state publishes the property condition and foundation reports. Contracts and listing forms are CT REALTORS forms for members.',
    sources: [
      src('ct-dcp', 'CT Dept. of Consumer Protection: real estate', 'https://portal.ct.gov/DCP/Common-Elements/Consumer-Facts-and-Contacts/Real-Estate', 'state', 'public', 'Residential property condition report, foundation condition report (effective July 1, 2025)'),
      src('ct-ctr', 'CT REALTORS forms', 'https://www.ctrealtors.com/members/forms/', 'association', 'members', 'Purchase contract, listing, buyer agency, addenda, disclosures'),
      src('ct-index', 'CT REALTORS forms library index (PDF)', 'https://www.ctrealtors.com/Customer-Content/www/CMS/files/Legal/CTR-Forms-Library.pdf', 'association', 'public', 'A public list of about 100 form names', 'The list only. The forms themselves are for members.'),
    ],
  },
  DE: {
    tier: 'disclosures',
    summary: 'The state publishes consumer disclosures such as the real property condition report. Contracts come from the Delaware Association of REALTORS.',
    sources: [
      src('de-dpr', 'Delaware Division of Professional Regulation: real estate forms', 'https://dpr.delaware.gov/boards/realestate/forms/', 'state', 'public', 'Real property condition report, radon disclosure, buyer and seller consumer notices'),
      src('de-dar', 'Delaware Association of REALTORS member forms', 'https://delawarerealtor.com/member-forms/', 'association', 'members', 'Agreement of sale, listing, addenda'),
    ],
  },
  FL: {
    tier: 'association',
    summary: 'The state commission publishes licensing forms only. The contracts (Florida Realtors/Bar forms) are for members.',
    sources: [src('fl-fr', 'Florida Realtors form descriptions', 'https://www.floridarealtors.org/tools-research/form-descriptions', 'association', 'members', 'Florida Realtors contracts and addenda', 'Behind a member login.')],
  },
  GA: {
    tier: 'association',
    summary: 'Georgia’s contracts are GAR forms: included with REALTOR membership, or bought as a yearly license by other Georgia licensees.',
    sources: [src('ga-gar', 'Georgia REALTORS forms', 'https://forms.garealtor.com/', 'association', 'paid', 'Listing, purchase and sale, seller’s property disclosure, buyer brokerage, addenda', 'Free to members; a 2026 forms license was $349 for non-members when checked.')],
  },
  HI: {
    tier: 'association',
    summary: 'The state commission has licensing and condo-developer forms only. The standard forms are Hawai‘i REALTORS forms, sold per page to licensees.',
    sources: [
      src('hi-har', 'Hawai‘i REALTORS forms for non-members', 'https://www.hawaiirealtors.com/forms-for-non-members', 'association', 'paid', 'How licensees buy the standard forms'),
      src('hi-index', 'HAR standard forms library index (PDF)', 'https://www.hawaiirealtors.com/file/c2ccsmhwk3vjs90/har_standard_forms_library_08_08.pdf', 'association', 'public', 'A public list of form names with revision dates', 'The list only. How current it is could not be confirmed.'),
    ],
  },
  ID: {
    tier: 'disclosures',
    summary: 'The state publishes the agency disclosure brochure. Contracts are Idaho REALTORS forms for members.',
    sources: [
      src('id-agency', 'Idaho agency disclosure brochure (PDF)', 'https://dopl.idaho.gov/wp-content/uploads/2025/06/2025-Agency-Disclosure-Brochure-FINAL.pdf', 'state', 'public', 'The Commission’s agency disclosure brochure, effective July 1, 2025'),
      src('id-ir', 'Idaho REALTORS forms', 'https://idahorealtors.com/forms/', 'association', 'members', 'Purchase, counteroffer, addenda'),
    ],
  },
  IL: {
    tier: 'association',
    summary: 'Illinois contracts come from Illinois REALTORS and the Chicago and other boards, behind member logins.',
    sources: [
      src('il-ir', 'Illinois REALTORS forms library', 'https://www.illinoisrealtors.org/legal/forms/', 'association', 'members', 'Listing, buyer agency and disclosure forms'),
      src('il-chi', 'Chicago REALTORS new and upcoming forms', 'https://chicagorealtor.com/new-upcoming-forms-contracts-for-2025/', 'association', 'members', 'Multi-Board residential contract and addenda (announcement page)', 'An announcement from 2025; check that it is still the current version.'),
    ],
  },
  IN: {
    tier: 'association',
    summary: 'Indiana’s forms are Indiana REALTORS forms, a member benefit through zipForms.',
    sources: [src('in-iar', 'Indiana REALTORS membership and forms', 'https://indianarealtors.com/membership/', 'association', 'members', 'Purchase agreement and listing contract (member benefit)')],
  },
  IA: {
    tier: 'association',
    summary: 'The state board lists licensing forms only. Contract and listing forms are Iowa REALTORS forms for members.',
    sources: [src('ia-iar', 'Iowa REALTORS Form Simplicity', 'https://iowarealtors.com/form-simplicity/', 'association', 'members', 'Buyer agreement, listing agreement, agency disclosure')],
  },
  KS: {
    tier: 'disclosures',
    summary: 'The Kansas Real Estate Commission publishes listing, buyer agency and brokerage disclosure forms. No purchase contract or property disclosure was seen there.',
    sources: [src('ks-krec', 'Kansas Real Estate Commission: forms', 'https://krec.ks.gov/resources/forms', 'state', 'public', 'Seller agency, buyer agency and transaction broker agreements, brokerage relationships disclosure, addenda', 'No version dates are shown on the page.')],
  },
  KY: {
    tier: 'disclosures',
    summary: 'The Kentucky Real Estate Commission publishes the seller’s property disclosure and the agency consent forms. No purchase contract or listing agreement was found.',
    sources: [
      src('ky-402', 'KREC Form 402: Seller’s Disclosure of Property Condition', 'https://www.krec.ky.gov/Documents/KREC%20Form%20402%20-%20Sellers%20Disclosure%20of%20Property%20Condition.pdf', 'state', 'public', 'The statutory property condition disclosure, dated 12/2022'),
      src('ky-401b', 'KREC Form 401B: Agency Consent Agreement (buyer)', 'https://www.krec.ky.gov/Documents/KREC%20Form%20401B%20-%20Agency%20Consent%20Agreement%20Buyer.pdf', 'state', 'public', 'Agency consent for buyers, dated 12/2022'),
      src('ky-401s', 'KREC Form 401S: Agency Consent Agreement (seller)', 'https://www.krec.ky.gov/Documents/KREC%20Form%20401S%20-%20Agency%20Consent%20Agreement%20Seller.pdf', 'state', 'public', 'Agency consent for sellers, dated 12/2022'),
    ],
  },
  LA: {
    tier: 'contracts',
    summary: 'The Louisiana Real Estate Commission publishes the mandatory residential purchase agreement and property disclosure, free.',
    sources: [
      src('la-forms', 'Louisiana Real Estate Commission: forms', 'https://lrec.gov/forms', 'state', 'public', 'Residential agreement to buy or sell, property disclosure, agency pamphlet, dual agency consent, suggested addenda, lead paint'),
      src('la-mandatory', 'Louisiana: mandatory forms', 'https://lrec.gov/form-categories/mandatory', 'state', 'public', 'The forms licensees must use', 'No effective dates are shown, only years in the titles.'),
      src('la-agency', 'Louisiana: agency disclosure forms', 'https://lrec.gov/form-categories/agency-disclosure-forms', 'state', 'public', 'Agency disclosure pamphlet and dual agency consent'),
    ],
  },
  ME: {
    tier: 'disclosures',
    summary: 'The Maine Real Estate Commission publishes the required brokerage relationships form. Contracts are Maine REALTORS forms; no public forms library was found.',
    sources: [src('me-mrec', 'Maine Real Estate Commission: applications and forms', 'https://maine.gov/pfr/professionallicensing/professions/real-estate-commission/applications-forms', 'state', 'public', 'Brokerage relationships form and offer guidelines (plus licensing forms)')],
  },
  MD: {
    tier: 'disclosures',
    summary: 'The Maryland Real Estate Commission publishes the property disclosure statement and the agency notice. Contracts are Maryland REALTORS forms for members.',
    sources: [
      src('md-prop', 'Maryland residential property disclosure and disclaimer statement', 'https://labor.maryland.gov/forms/propertydanddform.pdf', 'state', 'public', 'The statutory property disclosure, revised August 3, 2026'),
      src('md-agency', 'Maryland: Understanding whom real estate agents represent', 'https://labor.maryland.gov/forms/mrecrearep.pdf', 'state', 'public', 'The Commission’s agency notice, revised 10/14/2025'),
      src('md-mar', 'Maryland REALTORS forms', 'https://www.mdrealtor.org/Legal-Resources/Forms', 'association', 'members', 'Sales and listing contracts'),
    ],
  },
  MA: {
    tier: 'disclosures',
    summary: 'The state publishes the agency disclosure and the home inspection disclosure. The offer, purchase and sale and listing forms are association forms, mostly paid or for members.',
    sources: [
      src('ma-agency', 'Massachusetts mandatory licensee-consumer relationship disclosure', 'https://www.mass.gov/doc/real-estate-board-agency-disclosure-form-english/download', 'state', 'public', 'The Board’s agency disclosure, revised September 20, 2021'),
      src('ma-insp', 'Massachusetts mandatory residential home inspection disclosure', 'https://www.mass.gov/doc/massachusetts-mandatory-residential-home-inspection-disclosure/download', 'state', 'public', 'The home inspection disclosure'),
      src('ma-list', 'Commonly used forms: which are mandatory (Board course page)', 'https://www.mass.gov/info-details/re39r25-commonly-used-forms-residential-mandatoryoptional', 'state', 'public', 'Names the mandatory and optional residential forms', 'A course page that explains the forms; it does not link to them.'),
    ],
  },
  MI: {
    tier: 'association',
    summary: 'The state has no transaction forms we could find. Contracts are Michigan REALTORS forms.',
    sources: [src('mi-b1', 'Michigan REALTORS listing contract B-1 (PDF)', 'https://law.mirealtors.com/wp-content/uploads/2024/07/B.pdf', 'association', 'public', 'A blank exclusive listing contract (2024)', 'The only public Michigan REALTORS form we confirmed. The rest of the library was not verified.')],
  },
  MN: {
    tier: 'association',
    summary: 'Minnesota contracts are Minnesota Realtors forms through TransactionDesk or zipForm. The state page has deeds and closing blanks only.',
    sources: [
      src('mn-mnr', 'Minnesota Realtors forms', 'https://www.mnrealtor.com/forms', 'association', 'members', 'Over 70 documents, released each August', 'Includes a licensing policy for software vendors.'),
      src('mn-conv', 'Minnesota Commerce: uniform conveyancing blanks', 'https://mn.gov/commerce/business/real-estate/forms.jsp', 'state', 'public', 'Deeds, affidavits and powers of attorney (closing documents)'),
    ],
  },
  MS: {
    tier: 'disclosures',
    summary: 'The Mississippi Real Estate Commission publishes the property condition disclosure and agency forms. Contracts come from Mississippi Realtors.',
    sources: [
      src('ms-mrec', 'Mississippi Real Estate Commission: forms', 'https://www.mrec.ms.gov/forms/', 'state', 'public', 'Property condition disclosure statement, working with a broker form, co-op agreement, dual agency confirmation'),
      src('ms-mar', 'Mississippi Realtors standard forms update', 'https://msrealtors.org/mar-standard-forms-update/', 'association', 'members', 'Contract for sale and purchase (F-1), lots and land (F-2)', 'A news post, not the forms.'),
    ],
  },
  MO: {
    tier: 'association',
    summary: 'The state’s forms page could not be verified. Missouri contracts and disclosures are Missouri Realtors forms.',
    sources: [src('mo-mr', 'Missouri Realtors disclosure forms index', 'https://www.missourirealtor.org/missourirealtors/risk-management3/forms-index/disclosure-forms', 'association', 'mixed', 'Brokerage relationship, seller’s disclosure, wire fraud advisory and others', 'The list is visible; whether the forms open without a login was not confirmed.')],
  },
  MT: {
    tier: 'association',
    summary: 'The state board has licensing forms only. Transaction forms come from Montana Realtors, apparently for members.',
    sources: [src('mt-mar', 'Montana Realtors forms and legal info', 'https://www.montanarealtors.org/formsandlegalinfo/', 'association', 'members', 'Transaction forms through TransactionDesk or zipForm', 'No individual forms were visible.')],
  },
  NE: {
    tier: 'disclosures',
    summary: 'The Nebraska Real Estate Commission publishes listing, buyer representation, agency disclosure and seller disclosure forms. The purchase agreement comes from the Nebraska Realtors Association.',
    sources: [
      src('ne-nrec', 'Nebraska Real Estate Commission: forms list', 'https://nrec.nebraska.gov/licensing-forms/formlist.html', 'state', 'public', 'Exclusive right-to-sell listing contract, buyer representation contract, brokerage disclosures, seller property condition disclosure'),
      src('ne-agency', 'Nebraska: agency disclosures', 'https://nrec.nebraska.gov/legal/AGENCYDISCLOSURES2017.html', 'state', 'public', 'The required buyer, seller and landlord/tenant disclosure forms', 'The page title says 2017, so check the dates on the forms.'),
      src('ne-nra', 'Nebraska Realtors forms', 'https://nebraskarealtors.com/how-to-get-started-with-forms/', 'association', 'paid', 'Statewide forms through zipForm'),
    ],
  },
  NV: {
    tier: 'disclosures',
    summary: 'The Nevada Real Estate Division publishes dated disclosure forms, including the seller’s real property disclosure. It publishes no purchase contract or listing agreement.',
    sources: [
      src('nv-red', 'Nevada Real Estate Division: disclosure forms', 'https://red.nv.gov/Content/Forms/Disclosures', 'state', 'public', 'Consent to act, duties owed, seller’s real property disclosure (547), residential disclosure guide'),
      src('nv-547', 'Nevada Seller’s Real Property Disclosure (Form 547)', 'https://red.nv.gov/uploadedfiles/rednvgov/Content/Forms/547.pdf', 'state', 'public', 'The statutory form, revised June 1, 2023'),
    ],
  },
  NH: {
    tier: 'disclosures',
    summary: 'The commission publishes the brokerage relationship disclosure and a cooperating broker agreement. A New Hampshire REALTORS forms source was not verified.',
    sources: [src('nh-rec', 'NH Real Estate Commission: forms', 'https://oplc.nh.gov/nh-real-estate-commission-forms-and-other-documents', 'state', 'public', 'Brokerage relationship disclosure, consumer brochure, cooperating broker agreement')],
  },
  NJ: {
    tier: 'association',
    summary: 'The state commission page has licensing forms only. Contracts, listings and agency forms are NJ REALTORS forms behind membership; the state-approved Consumer Information Statement is on NJ REALTORS’ public page.',
    sources: [
      src('nj-cis', 'NJ REALTORS: Consumer Information Statement', 'https://www.njrealtor.com/consumer-information-statement/', 'association', 'public', 'The Consumer Information Statement (English approved by the NJ Real Estate Commission, August 2024)'),
      src('nj-zip', 'NJ REALTORS online forms update list', 'https://www.njrealtor.com/zipform/', 'association', 'members', 'Residential sales contract, listing agreement, seller’s disclosure, addenda', 'A changelog of form names and dates. The forms are for members.'),
    ],
  },
  NM: {
    tier: 'none',
    summary: 'The state commission page has complaint and records forms only. New Mexico Realtors (NMAR) forms are for members through its portal; no public page could be confirmed.',
    sources: [],
  },
  NY: {
    tier: 'disclosures',
    summary: 'The Department of State publishes the agency disclosure and the property condition disclosure statement. New York has no state purchase contract or listing agreement.',
    sources: [
      src('ny-agency', 'NY Department of State: real estate broker forms', 'https://dos.ny.gov/real-estate-broker-forms', 'state', 'public', 'Disclosure form for buyer and seller, and for landlord and tenant, in 13 languages'),
      src('ny-pcds', 'NY property condition disclosure statement', 'https://dos.ny.gov/property-condition-disclosure-statement', 'state', 'public', 'The Property Condition Disclosure Statement', 'Version labels differed between this page and the PDF; check the date on the form.'),
    ],
  },
  NC: {
    tier: 'association',
    summary: 'North Carolina’s standard contracts are NC REALTORS/NC Bar forms, meant for REALTOR members or used through an NC attorney. The Commission hosts the Working With Real Estate Agents brochure.',
    sources: [
      src('nc-lib', 'NC REALTORS forms library', 'https://www.ncrealtors.org/legal-ethics/forms-contracts/document-library/', 'association', 'mixed', 'Offer to purchase, listing agreement, buyer agency, property disclosure, lead paint', 'Lists about 25 forms, including watermarked samples. The forms policy says the standard forms are for members.'),
      src('nc-list', 'NC REALTORS forms list (PDF)', 'https://www.ncrealtors.org/wp-content/uploads/formslist.pdf', 'association', 'public', 'A public list of form numbers, titles and revision dates'),
      src('nc-rec', 'NC Real Estate Commission: publications', 'https://www.ncrec.gov/Publications/Pubs', 'state', 'public', 'Working With Real Estate Agents brochure (mandatory since 7/1/2021)'),
    ],
  },
  ND: {
    tier: 'association',
    summary: 'North Dakota’s statewide forms are North Dakota REALTORS forms for members. The commission’s own page could not be opened.',
    sources: [src('nd-nda', 'North Dakota REALTORS statewide forms', 'https://www.ndrealtors.com/membership/services/statewide-forms/', 'association', 'members', 'Statewide forms (login required)')],
  },
  OH: {
    tier: 'disclosures',
    summary: 'The state publishes the Agency Disclosure Statement and the Waiver of Duties. The residential property disclosure and contracts come from Ohio REALTORS.',
    sources: [
      src('oh-agency', 'Ohio Agency Disclosure Statement (PDF)', 'https://dam.assets.ohio.gov/image/upload/com.ohio.gov/REPL/Rebranded%20forms/Agency%20Disclosure%20Form/real_AgencyDisclosureForm.pdf', 'state', 'public', 'The agency disclosure, revised 8/29/2024'),
      src('oh-waiver', 'Ohio Waiver of Duties Statement', 'https://com.ohio.gov/divisions-and-programs/real-estate-and-professional-licensing/salespersons-and-brokers/transaction-forms-and-disclosures/waiver-of-duties-statement-form', 'state', 'public', 'English, Spanish and Somali versions'),
      src('oh-or', 'Ohio REALTORS: required disclosure forms', 'https://ohiorealtors.org/required-disclosure-forms', 'association', 'mixed', 'Explains the required agency, property and lead paint disclosures', 'The page is public. The form library is behind a login.'),
    ],
  },
  OK: {
    tier: 'contracts',
    summary: 'The Oklahoma Real Estate Commission publishes about 90 contract forms and addenda, free: residential sale, listing, buyer broker, disclosures, lead paint, leases.',
    sources: [src('ok-orec', 'Oklahoma Real Estate Commission: contract forms and addenda', 'https://oklahoma.gov/orec/contract-forms.html', 'state', 'public', 'Residential sale, listing, buyer broker, counteroffers, financing addenda, disclosures, lead paint, commercial and lease forms', 'The files sit in year-named folders, so link to this page rather than single PDFs.')],
  },
  OR: {
    tier: 'disclosures',
    summary: 'The Oregon Real Estate Agency publishes the initial agency disclosure pamphlet. Contracts are Oregon REALTORS forms, probably for members.',
    sources: [
      src('or-rea', 'Oregon Real Estate Agency: initial agency disclosure pamphlet', 'https://www.oregon.gov/rea/licensing/Pages/initial-agency-disclosure.aspx', 'state', 'public', 'The agency disclosure pamphlet (PDF and Word sample)'),
      src('or-or', 'Oregon REALTORS: 2026 form updates', 'https://oregonrealtors.org/news/forms-updates/winter-2026-form-updates/', 'association', 'mixed', 'Sale agreements, listing agreement, buyer representation (changelog)', 'A news article about the forms, not the forms. Library access was not confirmed.'),
    ],
  },
  PA: {
    tier: 'disclosures',
    summary: 'The State Real Estate Commission publishes the Written Consumer Notice. The agreement of sale and listing contract are PA Realtors forms for members.',
    sources: [
      src('pa-notice', 'Pennsylvania Written Consumer Notice (PDF)', 'https://pa.gov/content/dam/copapwp-pagov/en/dos/department-and-offices/bpoa/real-estate/Written%20Consumer%20Notice.pdf', 'state', 'public', 'Agency relationships notice'),
      src('pa-par', 'PA Realtors standard forms', 'https://www.parealtors.org/?p=38877', 'association', 'members', 'Agreement of sale, listing contract, addenda, with release dates'),
    ],
  },
  RI: {
    tier: 'association',
    summary: 'The state has licensing and escrow forms only. Contracts and disclosures are RIAR forms, for members only.',
    sources: [src('ri-riar', 'Rhode Island Association of REALTORS forms', 'https://www.rirealtors.org/riar-forms', 'association', 'members', 'Purchase and sales agreements, disclosures, addenda', 'RIAR says it does not provide forms to non-members.')],
  },
  SC: {
    tier: 'disclosures',
    summary: 'The Real Estate Commission publishes the property condition disclosure and agency forms. Contracts are SC REALTORS forms for members.',
    sources: [
      src('sc-llr', 'SC Real Estate Commission: approved forms and resources', 'https://llr.sc.gov/re/resources.aspx', 'state', 'public', 'Residential property condition disclosure, brokerage relationships disclosure, designated and dual agency agreements', 'Version dates on the page and file names do not agree; check the form.'),
      src('sc-scr', 'SC REALTORS forms', 'https://screaltors.org/forms/', 'association', 'members', 'Purchase and listing contracts'),
    ],
  },
  SD: {
    tier: 'contracts',
    summary: 'The South Dakota Department of Labor and Regulation publishes the residential purchase agreement, agency agreements and disclosures, free.',
    sources: [src('sd-dlr', 'South Dakota real estate transaction forms', 'https://dlr.sd.gov/realestate/real_estate_transaction_forms.aspx', 'state', 'public', 'Residential purchase agreement, owner and purchaser agency agreements, auction forms, relationship disclosure, seller property condition disclosure, lead paint', 'No version dates are shown, so confirm the form is current.')],
  },
  TN: {
    tier: 'association',
    summary: 'The state commission has licensing forms only. Transaction forms are Tennessee REALTORS forms for members.',
    sources: [src('tn-tr', 'Tennessee REALTORS member services', 'https://tnrealtors.com/members/member-services/', 'association', 'members', 'RF-series contracts through Transaction Desk and Forms on the Fly')],
  },
  UT: {
    tier: 'contracts',
    summary: 'The Utah Division of Real Estate publishes the state-approved Real Estate Purchase Contract and addenda. Listing and buyer-broker agreements are Utah REALTORS forms.',
    sources: [
      src('ut-dre', 'Utah state-approved real estate forms', 'https://commerce.utah.gov/forms/state-approved/', 'state', 'public', 'Real Estate Purchase Contract, FHA/VA, seller financing, assumption, earnest money, lead paint and other addenda', 'Check that the contract version is the current one: the files on this page were uploaded in 2023.'),
      src('ut-uar', 'Utah Association of REALTORS legal forms', 'https://utahrealtors.com/legal-form/', 'association', 'members', 'Listing agreement, buyer-broker agreement, compensation addenda'),
    ],
  },
  VT: {
    tier: 'disclosures',
    summary: 'The state publishes the two mandatory agency consumer disclosure forms. A Vermont REALTORS forms page was not found.',
    sources: [src('vt-opr', 'Vermont OPR: real estate forms', 'https://sos.vermont.gov/real-estate-brokers-salespersons/forms-instructions/', 'state', 'public', 'Designated and non-designated agency consumer disclosure forms (mandatory since 12/1/2015)')],
  },
  VA: {
    tier: 'disclosures',
    summary: 'The Real Estate Board publishes the residential property disclosure and other statutory forms. Virginia REALTORS posts the new residential purchase contract; the full library is for members.',
    sources: [
      src('va-dpor', 'Virginia DPOR: disclosure forms', 'https://www.dpor.virginia.gov/Consumers/Disclosure_Forms', 'state', 'public', 'Residential property disclosure acknowledgement, flood risk, septic waiver, military air installation and other statutory forms'),
      src('va-var', 'Virginia REALTORS: new residential purchase contract', 'https://virginiarealtors.org/law-ethics/new-residential-purchase-contract/', 'association', 'public', 'The new residential purchase contract (usable from May 4, 2026) and three addenda', 'The full forms library is for members.'),
    ],
  },
  WA: {
    tier: 'none',
    summary: 'The Department of Licensing has licensing forms only. Washington transaction forms come from NWMLS and Washington REALTORS; no public forms page could be confirmed.',
    sources: [],
  },
  WV: {
    tier: 'disclosures',
    summary: 'The Real Estate Commission publishes the Notice of Agency. A West Virginia REALTORS forms page was not found.',
    sources: [src('wv-rec', 'WV Real Estate Commission: forms', 'https://rec.wv.gov/Forms', 'state', 'public', 'Notice of Agency and guide to agency relationships (plus licensing forms)')],
  },
  WI: {
    tier: 'contracts',
    summary: 'The Wisconsin Department of Safety and Professional Services publishes the full set of WB forms (listing contracts, offers to purchase, buyer agency, amendments), free.',
    sources: [
      src('wi-dsps', 'Wisconsin real estate contractual forms library', 'https://dsps.wi.gov/a-z-boards-and-councils-list/re-contractual-forms/library/', 'state', 'public', 'About 40 WB forms: residential, farm, vacant land, condo and commercial listings and offers, buyer agency, amendments', 'No version dates on the page; file names carry dates.'),
      src('wi-wra', 'Wisconsin REALTORS Association forms', 'https://wra.org/Forms', 'association', 'members', 'Member forms library with zipForm'),
    ],
  },
  WY: {
    tier: 'none',
    summary: 'The commission has licensing and trust-account forms only. No Wyoming forms page for contracts could be confirmed.',
    sources: [],
  },
};

export function formSourcesFor(code: string): FormSource[] {
  const info = STATE_FORM_INFO[code];
  return info ? info.sources.map((s) => ({ ...s, state: code })) : [];
}

export function allFormSources(): FormSource[] {
  return Object.keys(STATE_FORM_INFO).flatMap(formSourcesFor);
}

export function findFormSource(id: string): FormSource | undefined {
  return allFormSources().find((s) => s.id === id);
}

export const TIER_LABEL: Record<StateTier, string> = {
  contracts: 'State publishes the contracts',
  disclosures: 'State publishes some forms',
  association: 'Contracts come from the REALTOR association',
  none: 'No public source confirmed',
};
