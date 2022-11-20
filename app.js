// https://cloud.google.com/appengine/docs/standard/nodejs/using-cloud-datastore
// https://cloud.google.com/nodejs/docs/reference/datastore/1.4.x/Datastore.html#get

// valid key 71020D1F-A42846BD-861A90ED-986BC3E9

const express = require("express");
const rp = require("request-promise");
const Datastore = require("@google-cloud/datastore");

const port = process.env.PORT || 8080;
const gumroadProduct = "XXX";
const maxDevicesPerLicenseKey = 1;
const dsNamespace = "google-plus-exporter-license";
const authToken = "XXX";
const sellerId = "XXX";

const datastore = Datastore();
const app = express();

app.enable("trust proxy");
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ limit: "32kb", extended: true }));

const dsCreateLicenseDevicesKey = (licenseKey) =>
	datastore.key({
		namespace: dsNamespace,
		path: [`${dsNamespace}-license-devices`, licenseKey],
	});

const dsCreatePurchasedLicenseKey = (licenseKey) =>
	datastore.key({
		namespace: dsNamespace,
		path: [`${dsNamespace}-purchased`, licenseKey],
	});

const isTimeoutError = (e) => e.toString().indexOf("ESOCKETTIMEDOUT") > -1;

const fetchLicenseKeyInfo = async (licenseKey) => {
	let tries = 0;
	while (true) {
		try {
			// eslint-disable-next-line
			return await rp({
				method: "POST",
				url: "https://api.gumroad.com/v2/licenses/verify",
				json: true,
				timeout: 3000,
				body: {
					product_permalink: gumroadProduct,
					license_key: licenseKey,
					increment_uses_count: true,
				},
				simple: false,
			});
		} catch (e) {
			if (!isTimeoutError(e) || ++tries === 3) {
				throw e;
			}
			await new Promise((resolve) => setTimeout(resolve, 250)); // eslint-disable-line
		}
	}
};

const verifyLicenseKey = async (licenseKey) => {
	if (!licenseKey) {
		return { ok: false, error: { code: "INVALID_LICENSE_KEY" } };
	}

	const dsLicensePurchasedKey = dsCreatePurchasedLicenseKey(licenseKey);

	// try to get the license key from the database
	const [licensePurchased] = (await datastore.get(dsLicensePurchasedKey)) || [];
	// console.log(`verifyLicenseKey license ${licenseKey} found in database:`, !!licensePurchased);
	if (licensePurchased) {
		return { ok: true };
	}

	const tm = new Date();
	const reply = await fetchLicenseKeyInfo(licenseKey);
	console.log(
		`Gumroad license verified in ${new Date() - tm}ms`,
		JSON.stringify(reply),
	);

	const ok =
		!!(reply && reply.success && reply.purchase && reply.purchase.id) || false;
	if (!ok) {
		return { ok: false, error: { code: "INVALID_LICENSE_KEY" } };
	}
	if (reply.purchase.refunded || reply.purchase.chargebacked) {
		return { ok: false, error: { code: "BLOCKED_LICENSE_KEY" } };
	}

	// console.log('verifyLicenseKey reply', JSON.stringify(reply));

	// store the license key to database
	await datastore.upsert({
		key: dsLicensePurchasedKey,
		data: {
			test: false,
			variants: [reply.purchase.variants],
		},
	});

	return { ok };
};

const catchError = (handler) => async (req, res, next) => {
	try {
		await handler(req, res);
	} catch (e) {
		console.error(e);
		if (res.headersSent) {
			return next(e);
		}
		return res.json({ ok: false, error: { code: "SERVER_ERROR" } }).end();
	}
	next();
};

app.post(
	"/verify",
	catchError(async (req, res) => {
		const { licenseKey, deviceId } = req.body || {};
		// console.log('/verify licenseKey', licenseKey, 'deviceId', deviceId);

		if (!deviceId) {
			return res
				.json({ ok: false, error: { code: "INVALID_DEVICE_ID" } })
				.end();
		}

		const reply = await verifyLicenseKey(licenseKey);
		if (!reply.ok) {
			return res.json(reply);
		}

		// begin: DISABLED
		// const dsLicenseDevicesKey = dsCreateLicenseDevicesKey(licenseKey);

		// const [licenseDevices = { registeredDevices: [] }] = (await datastore.get(dsLicenseDevicesKey)) || [];
		// // console.log('licenseDevices', licenseDevices);
		// const { registeredDevices } = licenseDevices;
		// // console.log('registeredDevices', registeredDevices);
		// if (registeredDevices.indexOf(deviceId) === -1) {
		//   return res.json({ ok: false, error: { code: 'UNKNOWN_DEVICE' } }).end();
		// }

		// // console.log('/verify OK licenseKey', licenseKey, 'deviceId', deviceId);
		// end: DISABLED

		res.json({ ok: true }).end();
	}),
);

app.post(
	"/activate",
	catchError(async (req, res) => {
		const { licenseKey, deviceId } = req.body || {};
		// console.log('/activate licenseKey', licenseKey, 'deviceId', deviceId);

		if (!deviceId) {
			return res
				.json({ ok: false, error: { code: "INVALID_DEVICE_ID" } })
				.end();
		}

		const reply = await verifyLicenseKey(licenseKey);
		if (!reply.ok) {
			return res.json(reply);
		}

		const dsLicenseDevicesKey = dsCreateLicenseDevicesKey(licenseKey);

		const [licenseDevices = { registeredDevices: [] }] =
			(await datastore.get(dsLicenseDevicesKey)) || [];
		// console.log('licenseDevices', licenseDevices);
		const { registeredDevices } = licenseDevices;
		const isDeviceNotRegistered = registeredDevices.indexOf(deviceId) === -1;
		// console.log('registeredDevices', registeredDevices, 'isDeviceNotRegistered', isDeviceNotRegistered);
		if (isDeviceNotRegistered) {
			if (registeredDevices.length >= maxDevicesPerLicenseKey) {
				return res
					.json({
						ok: false,
						error: {
							code: "DEVICE_COUNT_LICENSE_LIMIT_REACHED",
							count: registeredDevices.length,
							limit: maxDevicesPerLicenseKey,
						},
					})
					.end();
			}

			registeredDevices.push(deviceId);

			// register device
			await datastore.upsert({
				key: dsLicenseDevicesKey,
				data: {
					registeredDevices,
				},
			});
		}

		// console.log('/activate OK licenseKey', licenseKey, 'deviceId', deviceId);

		res.json({ ok: true }).end();
	}),
);

// https://gumroad.com/ping

app.post(
	"/webhook",
	catchError(async (req, res) => {
		const body = req.body || {};
		const isValid = req.query.token === authToken;
		const isValidSeller = req.body.seller_id === sellerId;
		const licenseKey = body.license_key;
		if (isValid && isValidSeller && licenseKey) {
			// console.log(`Gumroad license "${licenseKey}" purchase registered`);
			await datastore.upsert({
				key: dsCreatePurchasedLicenseKey(licenseKey),
				data: {
					test: !!body.test,
					variants: body.variants || [],
				},
			});
		} else {
			console.warn(
				`Gumroad license "${licenseKey}" purchase ignored! tokenValid:${isValid} seller:"${req.body.seller_id}"`,
			);
		}
		res.json({ ok: true }).end();
	}),
);

app.listen(port, () => console.log(`App listening on port ${port}`));

module.exports = app;
