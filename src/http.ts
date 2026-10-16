import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestInterceptor, CallHandler, ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, map } from 'rxjs';
import type { Request, Response } from 'express';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request.headers['x-request-id']?.toString() ?? randomUUID();
    return next.handle().pipe(map((data) => ({ success: true, data, meta: { timestamp: new Date().toISOString(), requestId } })));
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 400;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const code = exception instanceof Error ? exception.message : 'UNKNOWN_ERROR';
    const validation = typeof raw === 'object' && raw && 'message' in raw ? (raw as { message: unknown }).message : null;
    response.status(status).json({ success: false, error: { code, message: code, details: validation }, meta: { timestamp: new Date().toISOString(), requestId: request.headers['x-request-id']?.toString() ?? randomUUID() } });
  }
}
