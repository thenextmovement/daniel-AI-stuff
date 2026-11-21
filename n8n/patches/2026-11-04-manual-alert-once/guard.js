const response=$input.first().json;
if (response.statusCode !== 200 || typeof response.body?.approved !== 'boolean') throw new Error('manual_paid_error_mail_claim_unconfirmed');
if (!response.body.approved) return [];
const email={...$('Prepare Alert Data').first().json};
email.gateApproved=true;
email.gateVersion='manual-paid-atomic-v1';
return [{json:email}];