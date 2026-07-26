FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY conf/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 8081

CMD ["nginx", "-g", "daemon off;"]
