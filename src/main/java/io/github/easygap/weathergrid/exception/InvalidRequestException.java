package io.github.easygap.weathergrid.exception;

/** 외부 입력 검증 실패만 400으로 노출하기 위한 전용 예외. */
public class InvalidRequestException extends RuntimeException {
    public InvalidRequestException(String message) {
        super(message);
    }
}
