FROM nginx:alpine

RUN apk add --no-cache openssl

# remove default config
RUN rm /etc/nginx/conf.d/default.conf

# copy ours and put into the config folder
COPY conf/default.conf /etc/nginx/conf.d/

RUN mkdir -p /etc/nginx/ssl && \
	openssl req -x509 -nodes \
	-out /etc/nginx/ssl/transcendence.crt \
	-keyout /etc/nginx/ssl/transcendence.key \
	-subj "/C=MY/ST=SELANGOR/L=PETALINGJAYA/O=42KL/OU=mbani-ya/CN=localhost"

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]