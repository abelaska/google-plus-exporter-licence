curl -v -X POST -H 'Content-Type: application/json' -H "Accept: application/json" -d '{"licenseKey":"71020D1F-A42846BD-861A90ED-986BC3E9","deviceId":"0"}' https://google-plus-exporter-license-dot-fpm-application.appspot.com/activate

curl -v -X POST -H 'Content-Type: application/json' -H "Accept: application/json" -d '{"licenseKey":"71020D1F-A42846BD-861A90ED-986BC3E9","deviceId":"device0"}' https://google-plus-exporter-license-dot-fpm-application.appspot.com/verify

curl https://api.gumroad.com/v2/licenses/verify \
 -d "product_permalink=jEVTZ" \
 -d "license_key=71020D1F-A42846BD-861A90ED-986BC3E9" \
 -X POST
